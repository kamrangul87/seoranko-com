/**
 * Crawl rate limits.
 *
 * The per-user daily crawl-start quota is durable (Postgres-backed,
 * reserveCrawlStart/releaseCrawlStart below) — it has to be, since it's a
 * billing limit and must hold across separate serverless isolates, not
 * just within one. Per-host politeness (acquireHostFetchSlot) stays
 * in-process on purpose: it's a sub-second gap/concurrency guard against
 * the *target* site being crawled, not a cross-request limit, and adding a
 * DB round-trip to every single fetch would defeat its purpose.
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

const hostLastAt = new Map<string, number>()
const hostInFlight = new Map<string, number>()

function hostKey(urlOrOrigin: string): string {
  try {
    return new URL(urlOrOrigin).hostname.toLowerCase()
  } catch {
    return urlOrOrigin.toLowerCase()
  }
}

export interface CrawlStartReservation {
  allowed: boolean
  /** Present when allowed=false — human-readable block reason. */
  blockedReason: string | null
  /** Count for (user, UTC day) after this attempt. */
  count: number
}

/**
 * Atomically reserves one crawl-start slot for this user's UTC day.
 * Race-free across separate invocations (separate isolates, concurrent
 * requests) — the check-and-increment happens in a single
 * `UPDATE ... WHERE count < limit RETURNING` inside Postgres
 * (fix_strategies_try_reserve_crawl_start), which serializes on the
 * database's row lock for that (user_id, day) row. An in-process counter
 * cannot do this: it has no way to see another isolate's count at all.
 *
 * Call this BEFORE starting the crawl, and call releaseCrawlStart() if
 * starting the crawl then fails — a transient error must not permanently
 * burn a real quota slot.
 */
export async function reserveCrawlStart(
  userId: string,
  dailyLimit?: number,
): Promise<CrawlStartReservation> {
  const limit =
    typeof dailyLimit === 'number' && dailyLimit > 0
      ? dailyLimit
      : FIX_STRATEGY_PRODUCT_DECISIONS.crawlRunsPerUserPerDayFree
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('fix_strategies_try_reserve_crawl_start', {
    p_user_id: userId,
    p_limit: limit,
  })
  if (error) throw new Error(`crawl quota check failed: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as
    | { allowed: boolean; count: number }
    | undefined
  const allowed = Boolean(row?.allowed)
  return {
    allowed,
    blockedReason: allowed
      ? null
      : `Daily crawl quota reached (${limit} starts / UTC day). Subscribe for a higher limit, or try again tomorrow.`,
    count: Number(row?.count ?? 0),
  }
}

/**
 * Releases a reservation made by reserveCrawlStart when the crawl failed
 * to actually start. Non-throwing — a failure here shouldn't mask the
 * original crawl-start error, and worst case a slot stays consumed for a
 * day rather than corrupting the count.
 */
export async function releaseCrawlStart(userId: string): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.rpc('fix_strategies_release_crawl_start', {
    p_user_id: userId,
  })
  if (error) console.error('[rate-limit] releaseCrawlStart failed:', error.message)
}

/** Test helper — clear in-process host-politeness state. The daily quota
 * lives in Postgres now; tests that need a clean slate for it should
 * delete from fix_strategies_crawl_daily_starts directly. */
export function __resetCrawlRateLimitForTests(): void {
  hostLastAt.clear()
  hostInFlight.clear()
}

/** Wait for per-host gap + concurrency slot. */
export async function acquireHostFetchSlot(urlOrOrigin: string): Promise<() => void> {
  const host = hostKey(urlOrOrigin)
  const gap = FIX_STRATEGY_PRODUCT_DECISIONS.crawlPerHostMinGapMs
  const maxConc = FIX_STRATEGY_PRODUCT_DECISIONS.crawlPerHostMaxConcurrent

  for (;;) {
    const inflight = hostInFlight.get(host) ?? 0
    const last = hostLastAt.get(host) ?? 0
    const since = Date.now() - last
    if (inflight < maxConc && since >= gap) {
      hostInFlight.set(host, inflight + 1)
      hostLastAt.set(host, Date.now())
      return () => {
        hostInFlight.set(host, Math.max(0, (hostInFlight.get(host) ?? 1) - 1))
      }
    }
    const wait = Math.max(gap - since, 50)
    await new Promise((r) => setTimeout(r, wait))
  }
}

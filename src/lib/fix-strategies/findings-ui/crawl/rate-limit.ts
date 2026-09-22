/**
 * In-process crawl rate limits (per isolate). Values from product-decisions.
 */

import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

type DayBucket = { day: string; count: number }
const userDayStarts = new Map<string, DayBucket>()
const hostLastAt = new Map<string, number>()
const hostInFlight = new Map<string, number>()

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

function hostKey(urlOrOrigin: string): string {
  try {
    return new URL(urlOrOrigin).hostname.toLowerCase()
  } catch {
    return urlOrOrigin.toLowerCase()
  }
}

/** Returns null when allowed; otherwise a human-readable block reason. */
export function assertCrawlStartAllowed(userId: string): string | null {
  const limit = FIX_STRATEGY_PRODUCT_DECISIONS.crawlRunsPerUserPerDay
  const day = utcDay()
  const cur = userDayStarts.get(userId)
  if (!cur || cur.day !== day) {
    userDayStarts.set(userId, { day, count: 0 })
  }
  const bucket = userDayStarts.get(userId)!
  if (bucket.count >= limit) {
    return `Daily crawl quota reached (${limit} starts / UTC day). Try again tomorrow.`
  }
  return null
}

export function recordCrawlStart(userId: string): void {
  const day = utcDay()
  const cur = userDayStarts.get(userId)
  if (!cur || cur.day !== day) {
    userDayStarts.set(userId, { day, count: 1 })
    return
  }
  cur.count += 1
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

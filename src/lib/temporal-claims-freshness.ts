// src/lib/temporal-claims-freshness.ts
// Part 3d — weekly re-verification of registered temporal_claims. Re-fetches
// each due claim's source_url and confirms it still resolves (200/301).
// Never rewrites the article — flags drift for a human to review via the
// weekly digest. Distinct from freshness-automation.ts's runWeeklyFreshnessJobs,
// which rewrites whole-article prose for ranking decay; this only checks
// that a specific cited claim's source is still reachable.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface TemporalClaimDueRow {
  id: string
  article_id: string
  user_id: string
  claim_text: string
  source_url: string
}

export interface TemporalClaimDrift {
  claimId: string
  articleId: string
  userId: string
  claimText: string
  sourceUrl: string
  reason: string
}

export interface TemporalClaimsFreshnessResult {
  checked: number
  stillResolves: number
  drift: TemporalClaimDrift[]
}

const RESOLVING_STATUSES = new Set([200, 301])

async function sourceStillResolves(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ resolves: boolean; reason: string }> {
  try {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'manual' })
    if (RESOLVING_STATUSES.has(res.status)) {
      return { resolves: true, reason: `HTTP ${res.status}` }
    }
    return { resolves: false, reason: `HTTP ${res.status} — page no longer shows this figure or moved` }
  } catch (err) {
    return { resolves: false, reason: `unreachable — ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * Queries temporal_claims where review_by <= now and status = 'active',
 * re-checks each source_url, and updates status/last_verified_at. Returns
 * the drift list for the caller to fold into the weekly digest. Does NOT
 * touch articles.content — flag for review only, per the spec.
 */
export async function runTemporalClaimsFreshnessCheck(
  supabase: SupabaseClient,
  opts?: { now?: Date; limit?: number; fetchImpl?: typeof fetch },
): Promise<TemporalClaimsFreshnessResult> {
  const now = opts?.now ?? new Date()
  const fetchImpl = opts?.fetchImpl ?? fetch
  const limit = opts?.limit ?? 100

  const { data: due } = await supabase
    .from('temporal_claims')
    .select('id, article_id, user_id, claim_text, source_url')
    .lte('review_by', now.toISOString())
    .eq('status', 'active')
    .limit(limit)

  const dueRows = (due ?? []) as TemporalClaimDueRow[]
  const drift: TemporalClaimDrift[] = []
  let stillResolves = 0

  for (const row of dueRows) {
    const check = await sourceStillResolves(row.source_url, fetchImpl)
    if (check.resolves) {
      stillResolves++
      await supabase
        .from('temporal_claims')
        .update({ last_verified_at: now.toISOString() })
        .eq('id', row.id)
    } else {
      drift.push({
        claimId: row.id,
        articleId: row.article_id,
        userId: row.user_id,
        claimText: row.claim_text,
        sourceUrl: row.source_url,
        reason: check.reason,
      })
      await supabase
        .from('temporal_claims')
        .update({ status: 'flagged', last_verified_at: now.toISOString() })
        .eq('id', row.id)
    }
  }

  return { checked: dueRows.length, stillResolves, drift }
}

/** Convenience wrapper matching the other weekly cron jobs' service-role pattern. */
export async function runTemporalClaimsFreshnessJob(): Promise<TemporalClaimsFreshnessResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  return runTemporalClaimsFreshnessCheck(supabase)
}

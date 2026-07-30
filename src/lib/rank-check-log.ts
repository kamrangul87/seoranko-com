/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/rank-check-log.ts
// §10 item 1 — "Instrument before touching logic."
//
// One row per rank check. This is the evidence base for items 2-4:
//   item 2/3 (ground truth / data-in) — compare raw_rank_group and
//     raw_rank_absolute against a manual incognito check at the same locale
//   item 4 (matching) — stored_url_normalised vs matched_url shows whether a
//     null rank was "not ranking" or a matching failure
//   item 5 (trigger) — trigger_fired / trigger_reason show what the agent
//     decided and why
//
// Logging must never break a check: every failure here is swallowed.

import { RANK_CHECK_PARAMS, type RankCheckResult } from './rank-tracker'

export interface RankCheckLogEntry {
  userId?: string | null
  articleId?: string | null
  result: RankCheckResult
  triggerFired?: boolean
  triggerReason?: string | null
  actionTaken?: string | null
}

export async function logRankCheck(supabase: any, entry: RankCheckLogEntry): Promise<void> {
  const { result } = entry
  const d = result.diagnostics

  try {
    await supabase.from('rank_checks').insert({
      user_id: entry.userId ?? null,
      article_id: entry.articleId ?? null,

      keyword: result.keyword,
      location_code: result.locationCode,
      language_code: RANK_CHECK_PARAMS.language_code,
      device: RANK_CHECK_PARAMS.device,
      os: RANK_CHECK_PARAMS.os,
      depth: RANK_CHECK_PARAMS.depth,
      endpoint: RANK_CHECK_PARAMS.endpoint,

      raw_rank_group: d?.rankGroup ?? null,
      raw_rank_absolute: d?.rankAbsolute ?? null,
      matched_url: d?.matchedUrl ?? null,
      matched_domain: d?.matchedDomain ?? null,
      stored_url: result.articleUrl,
      stored_url_normalised: d?.storedUrlNormalised ?? null,
      match_method: d?.matchMethod ?? 'none',
      url_matched: d?.matchMethod ? d.matchMethod !== 'none' : false,
      organic_count: d?.organicCount ?? 0,
      serp_features: result.serpFeatures ?? [],
      api_error: d?.apiError ?? null,

      trigger_fired: entry.triggerFired ?? false,
      trigger_reason: entry.triggerReason ?? null,
      action_taken: entry.actionTaken ?? null,

      checked_at: result.checkedAt
    })
  } catch (err) {
    // Never let instrumentation take down the thing it instruments.
    console.error('[rank-check-log] failed to record check:', err)
  }
}

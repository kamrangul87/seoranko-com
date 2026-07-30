/* eslint-disable @typescript-eslint/no-explicit-any */
// §10 items 2-4 — the readout for the ground-truth / data-in / matching checks,
// and for the day-8 log review.
//
// Items 2, 3 and 6 are manual gates: they need a human comparing against an
// incognito SERP. This endpoint gives them something to compare against, and
// summarises the failure modes the doc predicts.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const cookieStore = cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days = Math.min(Number(req.nextUrl.searchParams.get('days') || 7), 90)
  const since = new Date(Date.now() - days * 86400_000).toISOString()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: checks, error } = await supabase
    .from('rank_checks')
    .select('*')
    .eq('user_id', user.id)
    .gte('checked_at', since)
    .order('checked_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = checks || []
  const n = rows.length

  // Item 3 — data-in. If the two rank fields disagree, the reported position
  // depends on which one we read, and only ground truth can settle it.
  const rankFieldsDisagree = rows.filter(r =>
    r.raw_rank_group != null && r.raw_rank_absolute != null &&
    r.raw_rank_group !== r.raw_rank_absolute
  )

  // Item 4 — matching. A null rank with organic results present is a matching
  // failure, not "not ranking".
  const nullRankWithResults = rows.filter(r =>
    r.raw_rank_group == null && r.match_method === 'none' && (r.organic_count || 0) > 0 && !r.api_error
  )

  // A domain-level match on a specific tracked page means we may be reporting
  // the wrong page's position.
  const domainOnlyMatches = rows.filter(r => r.match_method === 'same-domain')

  const apiFailures = rows.filter(r => r.api_error)

  const locales = Array.from(new Set(rows.map(r => `${r.location_code}/${r.language_code}/${r.device}`)))

  // Item 2/3 — compare each recorded manual observation against the nearest
  // agent check for the same keyword + locale. This is the actual data-in test.
  const { data: truth } = await supabase
    .from('rank_ground_truth')
    .select('*')
    .eq('user_id', user.id)
    .order('observed_at', { ascending: false })

  const comparisons = (truth || []).map((t: any) => {
    const candidates = rows.filter(r =>
      r.keyword?.toLowerCase() === t.keyword?.toLowerCase() &&
      r.location_code === t.location_code
    )
    // Nearest check in time to the manual observation.
    const nearest = candidates.sort((a, b) =>
      Math.abs(+new Date(a.checked_at) - +new Date(t.observed_at)) -
      Math.abs(+new Date(b.checked_at) - +new Date(t.observed_at))
    )[0]

    if (!nearest) {
      return { keyword: t.keyword, verdict: 'no-matching-check', observed: t.observed_position }
    }

    const observed = t.observed_position
    const group = nearest.raw_rank_group
    const absolute = nearest.raw_rank_absolute

    let verdict: string
    if (observed == null && group == null) verdict = 'agree-both-absent'
    else if (observed == null || group == null) verdict = 'DISAGREE-presence'
    else if (observed === group) verdict = 'agree-on-rank_group'
    else if (observed === absolute) verdict = 'WRONG-FIELD-should-read-rank_group'
    else verdict = 'DISAGREE-position'

    return {
      keyword: t.keyword,
      locationCode: t.location_code,
      observed,
      rankGroup: group,
      rankAbsolute: absolute,
      adsAbove: t.ads_above,
      absoluteMinusGroup: (absolute != null && group != null) ? absolute - group : null,
      matchMethod: nearest.match_method,
      verdict
    }
  })

  const verdictCounts = comparisons.reduce((acc: Record<string, number>, c: any) => {
    acc[c.verdict] = (acc[c.verdict] || 0) + 1
    return acc
  }, {})

  return NextResponse.json({
    windowDays: days,
    totalChecks: n,

    // Item 2/3 — request parameters actually sent. Compare against the locale
    // you check manually; a mismatch here explains any disagreement.
    localesSent: locales,

    item2_groundTruth: {
      observationsRecorded: (truth || []).length,
      verdicts: verdictCounts,
      comparisons: comparisons.slice(0, 30),
      note: (truth || []).length === 0
        ? 'No manual observations recorded yet. POST to /api/rank/ground-truth with { keyword, targetUrl, locationCode, observedPosition, adsAbove } for 10-20 keywords checked in incognito, then re-read this.'
        : 'WRONG-FIELD-should-read-rank_group means the agent is reporting rank_absolute where you observed the organic position — that is item 3\'s answer.'
    },

    item3_dataIn: {
      rankFieldsDisagree: rankFieldsDisagree.length,
      note: 'raw_rank_group is the organic position; raw_rank_absolute counts ads and snippets. Where they differ, confirm which matches your incognito check before trusting the reported position.',
      samples: rankFieldsDisagree.slice(0, 10).map(r => ({
        keyword: r.keyword, group: r.raw_rank_group, absolute: r.raw_rank_absolute, url: r.matched_url
      }))
    },

    item4_matching: {
      nullRankDespiteResults: nullRankWithResults.length,
      domainOnlyMatches: domainOnlyMatches.length,
      note: 'nullRankDespiteResults are matching failures, not absences. domainOnlyMatches mean a different page on your domain ranked, so the position may not belong to the tracked URL.',
      samples: nullRankWithResults.slice(0, 10).map(r => ({
        keyword: r.keyword, storedNormalised: r.stored_url_normalised, organicCount: r.organic_count
      }))
    },

    apiFailures: {
      count: apiFailures.length,
      note: 'A null position from an API error is not evidence the page does not rank.',
      messages: Array.from(new Set(apiFailures.map(r => r.api_error))).slice(0, 5)
    },

    triggers: {
      fired: rows.filter(r => r.trigger_fired).length,
      reasons: Array.from(new Set(rows.filter(r => r.trigger_reason).map(r => r.trigger_reason))).slice(0, 10)
    },

    readiness: n === 0
      ? 'No checks logged yet. Run some rank checks, then re-read this after seven days (§10).'
      : `${n} checks logged. Per §10, let it run untouched for seven days and read this on day eight.`
  })
}

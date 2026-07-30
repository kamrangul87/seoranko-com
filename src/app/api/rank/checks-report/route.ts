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

  return NextResponse.json({
    windowDays: days,
    totalChecks: n,

    // Item 2/3 — request parameters actually sent. Compare against the locale
    // you check manually; a mismatch here explains any disagreement.
    localesSent: locales,

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

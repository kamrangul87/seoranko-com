/* eslint-disable @typescript-eslint/no-explicit-any */
// §10 item 2 — record a manually observed SERP position.
//
// The observation itself is human work: open an incognito window at the same
// locale the agent sends, search the keyword, and count ORGANIC results only.
// This endpoint stores what you saw so /api/rank/checks-report can compare it
// against what the agent returned (item 3).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { normalizeUrl } from '@/lib/supabase/audit-db'

export const maxDuration = 30

async function requireUser() {
  const cookieStore = cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  return user
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const {
    keyword,
    targetUrl,
    locationCode,
    device = 'desktop',
    observedPosition = null,
    observedUrl = null,
    adsAbove = 0,
    notes = null
  } = body

  if (!keyword || !targetUrl || locationCode == null) {
    return NextResponse.json(
      { error: 'keyword, targetUrl and locationCode are required. locationCode must match what the agent sends (see localesSent in checks-report).' },
      { status: 400 }
    )
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // §8 — normalise before writing so this joins cleanly to rank_checks.
  const { data, error } = await supabase.from('rank_ground_truth').insert({
    user_id: user.id,
    keyword: String(keyword).trim(),
    target_url: normalizeUrl(String(targetUrl)),
    location_code: Number(locationCode),
    device,
    observed_position: observedPosition == null ? null : Number(observedPosition),
    observed_url: observedUrl ? normalizeUrl(String(observedUrl)) : null,
    ads_above: Number(adsAbove) || 0,
    notes
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    id: data.id,
    next: 'Record 10-20 keywords at mixed positions, then GET /api/rank/checks-report to see the comparison.'
  })
}

export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data } = await supabase
    .from('rank_ground_truth')
    .select('*')
    .eq('user_id', user.id)
    .order('observed_at', { ascending: false })

  return NextResponse.json({ observations: data || [], count: (data || []).length })
}

/**
 * Save per-site jurisdiction (UK / EU / US) and re-evaluate topic 72.
 * Never writes privacy or legal wording.
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import {
  normalizeSiteJurisdiction,
} from '@/lib/compliance/jurisdiction'
import { findingsResolvedByJurisdiction } from '@/lib/compliance/reevaluate-jurisdiction'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const cookieStore = cookies()
  const sb = createSupabaseSsrClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    siteId?: string
    jurisdiction?: string | null
  }
  if (!body.siteId) {
    return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
  }
  const jurisdiction = normalizeSiteJurisdiction(body.jurisdiction)
  if (body.jurisdiction && !jurisdiction) {
    return NextResponse.json(
      { error: 'Jurisdiction must be UK, EU, or US' },
      { status: 400 },
    )
  }

  const { data: site, error: siteErr } = await sb
    .from('connected_sites')
    .select('id')
    .eq('id', body.siteId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (siteErr || !site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  const { error: updErr } = await sb
    .from('connected_sites')
    .update({ privacy_jurisdiction: jurisdiction })
    .eq('id', body.siteId)
    .eq('user_id', user.id)
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  const service = createServiceRoleClient()
  const { data: rows, error: findErr } = await service
    .from('fix_strategies_findings')
    .select('id, verdict, status')
    .eq('site_id', body.siteId)
    .eq('user_id', user.id)
    .eq('verdict', 'human-review-jurisdiction-not-set')
    .in('status', ['open', 'regressed'])
  if (findErr) {
    return NextResponse.json({
      ok: true,
      jurisdiction,
      resolvedFindingIds: [],
      reevaluateWarning: findErr.message,
    })
  }
  const ids = findingsResolvedByJurisdiction(rows || [], jurisdiction)
  if (ids.length > 0) {
    const now = new Date().toISOString()
    await service
      .from('fix_strategies_findings')
      .update({
        status: 'resolved',
        resolved_at: now,
        updated_at: now,
      })
      .in('id', ids)
  }

  return NextResponse.json({
    ok: true,
    jurisdiction,
    resolvedFindingIds: ids,
  })
}

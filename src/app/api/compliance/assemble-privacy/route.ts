/**
 * Deterministic privacy-notice assembly. No LLM.
 * Dashboard shows "template — not legal advice"; page body does not.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseJsClient } from '@/lib/supabase/js-client'
import { assemblePrivacyPage } from '@/lib/compliance/assembler'
import { buildSiteInventory } from '@/lib/compliance/inventory'
import type { PrivacyOwnerFields } from '@/lib/compliance/assembler'


export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DASHBOARD_NOTE =
  'This is a template assembled from fixed clause library text — not legal advice.'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = auth.slice('Bearer '.length)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const userClient = createSupabaseJsClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json()) as {
    siteId?: string
    pages?: Array<{ url: string; html: string }>
    fields?: Partial<PrivacyOwnerFields>
  }

  if (!body.siteId) {
    return NextResponse.json({ error: 'siteId required' }, { status: 400 })
  }

  const { data: site, error: siteErr } = await userClient
    .from('connected_sites')
    .select(
      'id, privacy_jurisdiction, privacy_controller_name, privacy_controller_address, privacy_contact_email, privacy_retention_summary, privacy_retention_analytics, privacy_retention_forms',
    )
    .eq('id', body.siteId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (siteErr || !site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  const fields: PrivacyOwnerFields = {
    controllerName:
      body.fields?.controllerName ??
      (site.privacy_controller_name as string) ??
      '',
    controllerAddress:
      body.fields?.controllerAddress ??
      (site.privacy_controller_address as string) ??
      '',
    contactEmail:
      body.fields?.contactEmail ??
      (site.privacy_contact_email as string) ??
      '',
    jurisdiction:
      body.fields?.jurisdiction ??
      (site.privacy_jurisdiction as string) ??
      '',
    retentionSummary:
      body.fields?.retentionSummary ??
      (site.privacy_retention_summary as string) ??
      '',
    retentionAnalytics:
      body.fields?.retentionAnalytics ??
      (site.privacy_retention_analytics as string) ??
      '',
    retentionForms:
      body.fields?.retentionForms ??
      (site.privacy_retention_forms as string) ??
      '',
  }

  // Persist any provided fields (additive owner form).
  if (body.fields) {
    await userClient
      .from('connected_sites')
      .update({
        privacy_controller_name: fields.controllerName || null,
        privacy_controller_address: fields.controllerAddress || null,
        privacy_contact_email: fields.contactEmail || null,
        privacy_jurisdiction: fields.jurisdiction || null,
        privacy_retention_summary: fields.retentionSummary || null,
        privacy_retention_analytics: fields.retentionAnalytics || null,
        privacy_retention_forms: fields.retentionForms || null,
      })
      .eq('id', body.siteId)
      .eq('user_id', user.id)
  }

  const inventory = buildSiteInventory(
    (body.pages ?? []).map((p) => ({
      url: p.url,
      html: p.html,
      headers: null,
    })),
  )

  const assembled = assemblePrivacyPage(inventory, fields)
  if (!assembled.ok) {
    return NextResponse.json({
      ok: false,
      reasons: assembled.reasons,
      dashboardNote: DASHBOARD_NOTE,
    })
  }

  return NextResponse.json({
    ok: true,
    html: assembled.html,
    mdx: assembled.mdx,
    clauseLibraryVersion: assembled.clauseLibraryVersion,
    dashboardNote: DASHBOARD_NOTE,
    /** Explicit: do not put this string into the published page body. */
    notePlacement: 'dashboard_only',
  })
}

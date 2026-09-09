import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { normalizeUrl } from '@/lib/supabase/audit-db'
import { syncUrlInspectionsForConnection } from '@/lib/gsc/inspection-scheduler'
import { buildGscInspectionFixAgentIssues } from '@/lib/gsc/inspection-fix-issues'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function requireUser() {
  const cookieStore = cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
  const {
    data: { user },
  } = await authClient.auth.getUser()
  return user
}

/**
 * GET ?siteId= — latest inspection per URL for a site (for Index Diagnosis UI).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const siteId = req.nextUrl.searchParams.get('siteId') || ''
    if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

    const supabase = serviceClient()
    const { data: site } = await supabase
      .from('connected_sites')
      .select('id')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    // Latest row per URL via distinct-on style: fetch recent then fold.
    const { data: rows, error } = await supabase
      .from('gsc_url_inspections')
      .select(
        'id, url, inspected_at, verdict, coverage_state, robots_txt_state, indexing_state, google_canonical, user_canonical, canonical_mismatch, last_crawl_time, page_fetch_state, our_verdict, deltas',
      )
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .order('inspected_at', { ascending: false })
      .limit(2000)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const latestByUrl = new Map<string, (typeof rows)[number]>()
    for (const row of rows || []) {
      let key = row.url
      try {
        key = normalizeUrl(row.url)
      } catch {
        /* keep */
      }
      if (!latestByUrl.has(key)) latestByUrl.set(key, row)
    }

    const { data: quota } = await supabase
      .from('gsc_inspection_quota_usage')
      .select('day, requests_used, exhausted_at, property_url')
      .eq('site_id', siteId)
      .order('day', { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({
      ok: true,
      inspections: Array.from(latestByUrl.values()),
      quota: quota || null,
      framing:
        "Google's recorded index status + the specific mismatches we can prove + the fix for each. Not a ranking explanation.",
      fixAgentIssues: buildGscInspectionFixAgentIssues(
        Array.from(latestByUrl.values()).map((r) => ({
          url: r.url,
          deltas: r.deltas as never,
          google_canonical: r.google_canonical,
          user_canonical: r.user_canonical,
          coverage_state: r.coverage_state,
        })),
      ),
    })
  } catch (err) {
    console.error('[gsc/inspections GET]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not load inspections' }, { status: 500 })
  }
}

/**
 * POST { siteId } — run a quota-aware inspection batch for the site's GSC connection.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const siteId = typeof body.siteId === 'string' ? body.siteId : ''
    if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

    const supabase = serviceClient()
    const { data: conn } = await supabase
      .from('gsc_connections')
      .select('id')
      .eq('site_id', siteId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()
    if (!conn) {
      return NextResponse.json(
        { error: 'Connect Search Console and select a property first.' },
        { status: 400 },
      )
    }

    const result = await syncUrlInspectionsForConnection(supabase, conn.id)
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    console.error('[gsc/inspections POST]', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Inspection sync failed' },
      { status: 500 },
    )
  }
}

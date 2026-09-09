import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { loadLatestIndexDiagnosisRun } from '@/lib/index-diagnosis/persist'
import { loadLatestLinkGraphForDomain } from '@/lib/link-graph/persist'
import { normalizeDomain, normalizeUrl } from '@/lib/supabase/audit-db'
import {
  buildPageAuditPayloadFromRow,
  buildSavedAuditPayload,
} from '@/lib/audit-saved-payload'

function authClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value } } },
  )
}

/**
 * GET /api/audit/saved?domain=example.com  (or ?url=https://…)
 * Returns the latest persisted Index Diagnosis + Quality Gate + Link Graph.
 * Never returns empty/stub diagnosis as a successful restore — sets needsFreshCrawl.
 */
export async function GET(req: NextRequest) {
  const supabase = authClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const domainOrUrl =
    req.nextUrl.searchParams.get('domain')?.trim() ||
    req.nextUrl.searchParams.get('url')?.trim() ||
    ''
  if (!domainOrUrl) {
    return NextResponse.json({ error: 'domain or url is required' }, { status: 400 })
  }

  const domain = normalizeDomain(domainOrUrl)
  const diagnosis = await loadLatestIndexDiagnosisRun(user.id, domain)
  const linkGraph = await loadLatestLinkGraphForDomain(supabase, domain)

  const seedUrl =
    diagnosis?.result.coverage.seedUrl ||
    (domainOrUrl.startsWith('http') ? domainOrUrl : `https://${domain}/`)
  const pageUrl = normalizeUrl(seedUrl)

  const { data: pageRow } = await supabase
    .from('site_audit_results')
    .select(
      'score, http_status, word_count, title, h1, meta_description, has_schema, issues, opportunities, last_audited_at, page_url',
    )
    .eq('domain', domain)
    .eq('page_url', pageUrl)
    .eq('user_id', user.id)
    .maybeSingle()

  // Fallback: any row for this domain matching the requested URL host path variants
  let resolvedPage = pageRow
  if (!resolvedPage) {
    const { data: alts } = await supabase
      .from('site_audit_results')
      .select(
        'score, http_status, word_count, title, h1, meta_description, has_schema, issues, opportunities, last_audited_at, page_url',
      )
      .eq('domain', domain)
      .eq('user_id', user.id)
      .order('last_audited_at', { ascending: false })
      .limit(5)
    const want = normalizeUrl(domainOrUrl.startsWith('http') ? domainOrUrl : seedUrl)
    resolvedPage = (alts || []).find((r) => normalizeUrl(r.page_url) === want) || null
  }

  const pageAudit = resolvedPage
    ? buildPageAuditPayloadFromRow({
        url: normalizeUrl(resolvedPage.page_url || pageUrl),
        row: resolvedPage,
        diagnosis: diagnosis?.result ?? null,
      })
    : null

  const tablesMissing =
    diagnosis === null &&
    linkGraph === null &&
    pageAudit === null &&
    (await (async () => {
      const probe = await supabase.from('index_diagnosis_runs').select('id', { head: true, count: 'exact' }).limit(1)
      return Boolean(probe.error?.message?.match(/does not exist|schema cache|PGRST/i))
    })())

  return NextResponse.json(
    buildSavedAuditPayload({
      domain,
      diagnosis,
      pageAudit,
      linkGraph,
      tablesMissing,
    }),
  )
}

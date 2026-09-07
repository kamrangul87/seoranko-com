import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { loadLatestIndexDiagnosisRun } from '@/lib/index-diagnosis/persist'
import { loadLatestLinkGraphForDomain } from '@/lib/link-graph/persist'
import { normalizeDomain } from '@/lib/supabase/audit-db'

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
 * Returns the latest persisted Index Diagnosis + Link Graph for the signed-in user.
 * Does not re-crawl — used to restore Audit UI across page loads.
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

  const tablesMissing =
    diagnosis === null &&
    linkGraph === null &&
    // Distinguish empty history from missing tables via a cheap probe
    (await (async () => {
      const probe = await supabase.from('index_diagnosis_runs').select('id', { head: true, count: 'exact' }).limit(1)
      return Boolean(probe.error?.message?.match(/does not exist|schema cache|PGRST/i))
    })())

  return NextResponse.json({
    ok: true,
    domain,
    saved: Boolean(diagnosis || linkGraph),
    tablesMissing,
    indexDiagnosisRunId: diagnosis?.row.id ?? null,
    indexDiagnosis: diagnosis?.result ?? null,
    indexDiagnosisCreatedAt: diagnosis?.row.created_at ?? null,
    linkGraph: linkGraph
      ? {
          auditId: linkGraph.audit.id,
          createdAt: linkGraph.audit.created_at,
          summary: {
            verdictHeadline: linkGraph.audit.verdict_headline,
            topCauses: linkGraph.audit.top_causes,
            findingCount: linkGraph.findingCount,
            criticalCount: linkGraph.criticalCount,
            failCount: linkGraph.failCount,
            warnCount: linkGraph.warnCount,
            jsSuspected: linkGraph.audit.js_suspected,
            trailingSlashConvention: linkGraph.audit.trailing_slash_convention,
          },
          topFindings: linkGraph.topFindings,
        }
      : null,
  })
}

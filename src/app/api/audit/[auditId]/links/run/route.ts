import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { normalizeDomain } from '@/lib/supabase/audit-db'
import { runIndexDiagnosis } from '@/lib/index-diagnosis/run'
import { linkGraphInputFromDiagnosis } from '@/lib/link-graph/from-diagnosis'
import { runLinkGraphAudit } from '@/lib/link-graph/run'
import { persistLinkGraphResult } from '@/lib/link-graph/persist'
import { selectDiagnosisForLinkGraphRun } from '@/lib/link-graph/select-diagnosis'
import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'

export const maxDuration = 300

function authClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value } } },
  )
}

/**
 * POST /api/audit/[auditId]/links/run
 * auditId may be:
 * - "new" (or body.forceFresh) — always run a fresh Index Diagnosis crawl
 * - an index_diagnosis_runs id — re-analyse that run (may use body.diagnosis htmlByUrl)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { auditId: string } },
) {
  try {
    const supabase = authClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const auditId = params.auditId
    const forceFresh = body.forceFresh === true || auditId === 'new'

    let crawled: IndexDiagnosisResult | null = null
    let diagnosisRunId: string | null = null
    const bodyDiagnosis =
      body.diagnosis && typeof body.diagnosis === 'object'
        ? (body.diagnosis as IndexDiagnosisResult)
        : null

    if (forceFresh) {
      const domainOrUrl =
        typeof body.domain === 'string'
          ? body.domain.trim()
          : typeof body.url === 'string'
            ? body.url.trim()
            : typeof bodyDiagnosis?.coverage?.seedUrl === 'string'
              ? bodyDiagnosis.coverage.seedUrl
              : typeof bodyDiagnosis?.coverage?.domain === 'string'
                ? bodyDiagnosis.coverage.domain
                : ''
      if (!domainOrUrl) {
        return NextResponse.json(
          { error: 'domain or url required for a fresh Link Graph run' },
          { status: 400 },
        )
      }
      const seed = domainOrUrl.startsWith('http')
        ? domainOrUrl
        : `https://${normalizeDomain(domainOrUrl)}/`
      // Always crawl now — never trust client diagnosis (often a saved stale crawl).
      crawled = await runIndexDiagnosis(seed)
    } else {
      const { data: run, error } = await supabase
        .from('index_diagnosis_runs')
        .select('id, domain, seed_url, coverage, pages')
        .eq('id', auditId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (error || !run) {
        return NextResponse.json({ error: 'Index Diagnosis run not found' }, { status: 404 })
      }
      diagnosisRunId = run.id
      // Persisted runs may lack htmlByUrl — fall back to fresh crawl for same seed
      if (!(bodyDiagnosis?.htmlByUrl && bodyDiagnosis?.pages)) {
        crawled = await runIndexDiagnosis(run.seed_url || `https://${run.domain}/`)
      }
    }

    const diagnosis = selectDiagnosisForLinkGraphRun({
      auditId,
      forceFresh,
      crawled,
      bodyDiagnosis,
    })

    if (!diagnosis) {
      return NextResponse.json({ error: 'Could not load crawl data' }, { status: 400 })
    }

    const input = linkGraphInputFromDiagnosis(diagnosis)
    const result = await runLinkGraphAudit(input, {
      resolveExternal: body.resolveExternal === true,
    })

    const linkAuditId = await persistLinkGraphResult(supabase, {
      userId: user.id,
      domain: diagnosis.coverage.domain,
      seedUrl: diagnosis.coverage.seedUrl,
      indexDiagnosisRunId: diagnosisRunId,
      result,
    })

    const redirectRules = new Set(['L04', 'L05'])
    return NextResponse.json({
      ok: true,
      auditId: linkAuditId,
      crawlSource: forceFresh ? 'fresh' : bodyDiagnosis?.htmlByUrl ? 'client' : 'fresh',
      summary: {
        verdictHeadline: result.verdictHeadline,
        topCauses: result.topCauses,
        findingCount: result.findings.length,
        edgeCount: result.edges.length,
        targetCount: result.targets.length,
        trailingSlashConvention: result.trailingSlashConvention,
        jsSuspected: result.jsSuspected,
        criticalCount: result.findings.filter((f) => f.severity === 'CRITICAL').length,
        failCount: result.findings.filter((f) => f.severity === 'FAIL').length,
        warnCount: result.findings.filter((f) => f.severity === 'WARN').length,
        redirectHopCount: result.findings.filter((f) => redirectRules.has(f.ruleId)).length,
      },
      findings: result.rankedFindings.slice(0, 100),
      topFindings: result.rankedFindings
        .filter((f) => f.severity === 'CRITICAL' || f.severity === 'FAIL')
        .slice(0, 30),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Link graph run failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

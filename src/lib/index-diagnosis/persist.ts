import { createClient } from '@supabase/supabase-js'
import { normalizeDomain } from '@/lib/supabase/audit-db'
import { buildSiteFollowUpTasks } from './follow-up-tasks'
import { buildManualFixesForResult } from './manual-fixes'
import type {
  CohortMetrics,
  CrawlCoverage,
  IndexDiagnosisCause,
  IndexDiagnosisResult,
  InboundLinkEvidence,
  PageIndexability,
} from './types'

export type IndexDiagnosisRunRow = {
  id: string
  domain: string
  seed_url: string
  verdict_headline: string
  coverage: CrawlCoverage
  pages: PageIndexability[]
  cohorts: CohortMetrics[]
  top_causes: IndexDiagnosisCause[]
  indexable_count: number
  blocked_count: number
  at_risk_count: number
  created_at: string
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

/** Rebuild a displayable IndexDiagnosisResult from a persisted run row (no htmlByUrl). */
export function reconstructIndexDiagnosisFromRow(row: IndexDiagnosisRunRow): IndexDiagnosisResult {
  const inboundLinksByUrl: Record<string, InboundLinkEvidence[]> = {}
  for (const page of row.pages || []) {
    if (page.inboundLinks?.length) inboundLinksByUrl[page.url] = page.inboundLinks
  }

  const partial: IndexDiagnosisResult = {
    coverage: row.coverage,
    pages: row.pages || [],
    cohorts: row.cohorts || [],
    verdict: {
      headline: row.verdict_headline,
      topCauses: row.top_causes || [],
      indexableCount: row.indexable_count,
      blockedCount: row.blocked_count,
      atRiskCount: row.at_risk_count,
    },
    followUpTasks: [],
    inboundLinksByUrl,
    crawlerJsLimitation: true,
    ranAt: row.created_at,
  }

  const followUpTasks = buildSiteFollowUpTasks(partial)
  partial.followUpTasks = followUpTasks
  const inboundMap = new Map(Object.entries(inboundLinksByUrl))
  partial.manualFixesByTaskId = buildManualFixesForResult(partial, inboundMap)
  return partial
}

export async function persistIndexDiagnosisRun(
  userId: string,
  result: IndexDiagnosisResult,
): Promise<{ id: string | null; error: string | null }> {
  try {
    const supabase = serviceClient()
    const { data, error } = await supabase
      .from('index_diagnosis_runs')
      .insert({
        user_id: userId,
        domain: result.coverage.domain,
        seed_url: result.coverage.seedUrl,
        verdict_headline: result.verdict.headline,
        coverage: result.coverage,
        pages: result.pages,
        cohorts: result.cohorts,
        top_causes: result.verdict.topCauses,
        indexable_count: result.verdict.indexableCount,
        blocked_count: result.verdict.blockedCount,
        at_risk_count: result.verdict.atRiskCount,
      })
      .select('id')
      .maybeSingle()

    if (error) {
      console.warn('[index-diagnosis] persist failed', error.message)
      return { id: null, error: error.message }
    }
    return { id: data?.id ?? null, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'persist error'
    console.warn('[index-diagnosis] persist error', err)
    return { id: null, error: message }
  }
}

export async function loadLatestIndexDiagnosisRun(
  userId: string,
  domainOrUrl: string,
): Promise<{ row: IndexDiagnosisRunRow; result: IndexDiagnosisResult } | null> {
  try {
    const domain = normalizeDomain(domainOrUrl)
    const supabase = serviceClient()
    const { data, error } = await supabase
      .from('index_diagnosis_runs')
      .select(
        'id, domain, seed_url, verdict_headline, coverage, pages, cohorts, top_causes, indexable_count, blocked_count, at_risk_count, created_at',
      )
      .eq('user_id', userId)
      .eq('domain', domain)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn('[index-diagnosis] load failed', error.message)
      return null
    }
    if (!data) return null

    const row = data as IndexDiagnosisRunRow
    return { row, result: reconstructIndexDiagnosisFromRow(row) }
  } catch (err) {
    console.warn('[index-diagnosis] load error', err)
    return null
  }
}

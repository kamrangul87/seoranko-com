/**
 * Shape GET /api/audit/saved JSON from loaded persist rows — pure for tests.
 * Ensures reload hydration does not require a re-crawl.
 */

import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'
import type { IndexDiagnosisRunRow } from '@/lib/index-diagnosis/persist'

export type SavedLinkGraphPayload = {
  auditId: string
  createdAt: string
  summary: {
    verdictHeadline: string
    topCauses: unknown
    findingCount: number
    criticalCount: number
    failCount: number
    warnCount: number
    jsSuspected: boolean
    trailingSlashConvention: boolean
  }
  topFindings: unknown[]
}

export function buildSavedAuditPayload(opts: {
  domain: string
  diagnosis: { row: IndexDiagnosisRunRow; result: IndexDiagnosisResult } | null
  linkGraph: {
    audit: {
      id: string
      created_at: string
      verdict_headline: string
      top_causes: unknown
      js_suspected: boolean
      trailing_slash_convention: boolean
    }
    findingCount: number
    criticalCount: number
    failCount: number
    warnCount: number
    topFindings: unknown[]
  } | null
  tablesMissing: boolean
}) {
  return {
    ok: true as const,
    domain: opts.domain,
    saved: Boolean(opts.diagnosis || opts.linkGraph),
    tablesMissing: opts.tablesMissing,
    indexDiagnosisRunId: opts.diagnosis?.row.id ?? null,
    indexDiagnosis: opts.diagnosis?.result ?? null,
    indexDiagnosisCreatedAt: opts.diagnosis?.row.created_at ?? null,
    linkGraph: opts.linkGraph
      ? ({
          auditId: opts.linkGraph.audit.id,
          createdAt: opts.linkGraph.audit.created_at,
          summary: {
            verdictHeadline: opts.linkGraph.audit.verdict_headline,
            topCauses: opts.linkGraph.audit.top_causes,
            findingCount: opts.linkGraph.findingCount,
            criticalCount: opts.linkGraph.criticalCount,
            failCount: opts.linkGraph.failCount,
            warnCount: opts.linkGraph.warnCount,
            jsSuspected: opts.linkGraph.audit.js_suspected,
            trailingSlashConvention: opts.linkGraph.audit.trailing_slash_convention,
          },
          topFindings: opts.linkGraph.topFindings,
        } satisfies SavedLinkGraphPayload)
      : null,
  }
}

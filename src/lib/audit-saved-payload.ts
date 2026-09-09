/**
 * Pure helpers: shape GET /api/audit/saved and decide whether restore is safe.
 */

import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'
import type { IndexDiagnosisRunRow } from '@/lib/index-diagnosis/persist'
import {
  isUsableIndexDiagnosis,
  isUsablePageAuditSnapshot,
  savedAuditNeedsFreshCrawl,
  type PageAuditSnapshot,
} from '@/lib/index-diagnosis/saved-validity'
import { buildIndexDiagnosisFixAgentIssues } from '@/lib/index-diagnosis/fix-agent-issues'
import type { PageAuditIssue } from '@/lib/page-audit-engine'
import type { AuditIssue } from '@/lib/site-audit/scorer'
import type { QualityDimensionId } from '@/lib/quality-score-dimensions'
import { buildExplainableScore } from '@/lib/quality-score-dimensions'

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

export type SavedPageAuditPayload = {
  url: string
  score: number
  httpStatus: number
  wordCount: number
  title: string
  h1: string
  metaDescription: string
  hasSchema: boolean
  issues: PageAuditIssue[]
  opportunities: unknown[]
  explainable: ReturnType<typeof buildExplainableScore>
  lastAuditedAt: string | null
}

function mapStoredAuditIssue(issue: AuditIssue, index: number): PageAuditIssue {
  const severity =
    issue.severity === 'critical' ? 'critical' : issue.severity === 'warning' ? 'warning' : 'info'
  const dimMap: Record<string, QualityDimensionId[]> = {
    crawlability: ['technical_seo'],
    onpage: ['technical_seo', 'editorial'],
    technical: ['technical_seo'],
    content: ['editorial', 'readability'],
    schema: ['structured_data'],
    security: ['technical_seo'],
    speed: ['technical_seo'],
    ai: ['editorial'],
    links: ['internal_linking'],
    mobile: ['technical_seo'],
    depth: ['editorial'],
  }
  const stableId = issue.fix_type
    ? `audit-${issue.fix_type}-${index}`
    : `audit-${issue.category}-${index}`
  return {
    id: stableId,
    severity,
    category: issue.category,
    title: issue.message,
    description: issue.current_value
      ? `${issue.message} (current: ${issue.current_value})`
      : issue.message,
    remediation: issue.fix_preview || issue.fix_value || undefined,
    affectsDimensions: dimMap[issue.category] || ['technical_seo'],
    blocking: severity === 'critical',
  }
}

function coercePageAuditIssues(raw: unknown): PageAuditIssue[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  // Already PageAuditIssue-shaped (id + title)
  if (raw[0] && typeof raw[0] === 'object' && 'id' in (raw[0] as object) && 'title' in (raw[0] as object)) {
    return raw as PageAuditIssue[]
  }
  // Scorer AuditIssue-shaped (message + category)
  if (raw[0] && typeof raw[0] === 'object' && 'message' in (raw[0] as object)) {
    return (raw as AuditIssue[]).map(mapStoredAuditIssue)
  }
  return []
}

export function buildPageAuditPayloadFromRow(opts: {
  url: string
  row: {
    score: number
    http_status: number
    word_count: number
    title?: string | null
    h1?: string | null
    meta_description?: string | null
    has_schema?: boolean | null
    issues?: unknown
    opportunities?: unknown
    last_audited_at?: string | null
  }
  diagnosis?: IndexDiagnosisResult | null
}): SavedPageAuditPayload {
  const qgIssues = coercePageAuditIssues(opts.row.issues)
  const idxIssues = opts.diagnosis
    ? buildIndexDiagnosisFixAgentIssues(opts.diagnosis, opts.diagnosis.sitemapDrift ?? null)
    : []
  // Prefer QG issues; append Index Diagnosis Fix Agent bridge issues not already present.
  const seen = new Set(qgIssues.map((i) => i.id))
  const issues = [...qgIssues, ...idxIssues.filter((i) => !seen.has(i.id))]
  const explainable = buildExplainableScore(issues)

  return {
    url: opts.url,
    score: opts.row.score ?? 0,
    httpStatus: opts.row.http_status ?? 0,
    wordCount: opts.row.word_count ?? 0,
    title: opts.row.title || '',
    h1: opts.row.h1 || '',
    metaDescription: opts.row.meta_description || '',
    hasSchema: !!opts.row.has_schema,
    issues,
    opportunities: Array.isArray(opts.row.opportunities) ? opts.row.opportunities : [],
    explainable,
    lastAuditedAt: opts.row.last_audited_at ?? null,
  }
}

export function buildSavedAuditPayload(opts: {
  domain: string
  diagnosis: { row: IndexDiagnosisRunRow; result: IndexDiagnosisResult } | null
  pageAudit: SavedPageAuditPayload | null
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
  const pageSnap: PageAuditSnapshot | null = opts.pageAudit
    ? {
        score: opts.pageAudit.score,
        httpStatus: opts.pageAudit.httpStatus,
        wordCount: opts.pageAudit.wordCount,
        issues: opts.pageAudit.issues,
        title: opts.pageAudit.title,
        h1: opts.pageAudit.h1,
      }
    : null

  const usableDiagnosis = isUsableIndexDiagnosis(opts.diagnosis?.result)
  const usablePage = isUsablePageAuditSnapshot(pageSnap)
  const { needsFreshCrawl, reason } = savedAuditNeedsFreshCrawl({
    diagnosis: opts.diagnosis?.result,
    pageAudit: pageSnap,
  })

  return {
    ok: true as const,
    domain: opts.domain,
    saved: Boolean(opts.diagnosis || opts.linkGraph || opts.pageAudit),
    tablesMissing: opts.tablesMissing,
    needsFreshCrawl,
    needsFreshCrawlReason: reason,
    usableDiagnosis,
    usablePageAudit: usablePage,
    indexDiagnosisRunId: usableDiagnosis ? opts.diagnosis?.row.id ?? null : null,
    indexDiagnosis: usableDiagnosis ? opts.diagnosis?.result ?? null : null,
    indexDiagnosisCreatedAt: usableDiagnosis ? opts.diagnosis?.row.created_at ?? null : null,
    pageAudit: usablePage ? opts.pageAudit : null,
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

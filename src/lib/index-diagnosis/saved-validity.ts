/**
 * Mechanical validity for restored Index Diagnosis / page-audit snapshots.
 * Empty or stub rows must never be served as a successful restore.
 */

import type { IndexDiagnosisResult, PageIndexability } from './types'

export type PageAuditSnapshot = {
  score: number
  httpStatus: number
  wordCount: number
  issues: unknown[]
  title?: string
  h1?: string
}

/**
 * Schema-validate a stored Index Diagnosis payload.
 * Soft heuristics alone are not enough — malformed pages/coverage must fail.
 */
export function isSchemaValidIndexDiagnosis(
  result: unknown,
): result is IndexDiagnosisResult {
  if (!result || typeof result !== 'object') return false
  const r = result as Record<string, unknown>
  const coverage = r.coverage
  if (!coverage || typeof coverage !== 'object') return false
  const c = coverage as Record<string, unknown>
  if (typeof c.domain !== 'string' || !c.domain.trim()) return false
  if (typeof c.seedUrl !== 'string' || !c.seedUrl.trim()) return false
  if (typeof c.fetchedCount !== 'number' || Number.isNaN(c.fetchedCount)) return false
  if (typeof c.discoveredCount !== 'number' || Number.isNaN(c.discoveredCount)) return false
  if (!Array.isArray(r.pages)) return false
  for (const page of r.pages) {
    if (!isSchemaValidPageIndexability(page)) return false
  }
  const verdict = r.verdict
  if (!verdict || typeof verdict !== 'object') return false
  const v = verdict as Record<string, unknown>
  if (typeof v.headline !== 'string') return false
  if (typeof v.indexableCount !== 'number') return false
  if (typeof v.blockedCount !== 'number') return false
  if (typeof v.atRiskCount !== 'number') return false
  return true
}

function isSchemaValidPageIndexability(page: unknown): page is PageIndexability {
  if (!page || typeof page !== 'object') return false
  const p = page as Record<string, unknown>
  if (typeof p.url !== 'string' || !p.url.trim()) return false
  if (p.verdict !== 'INDEXABLE' && p.verdict !== 'BLOCKED' && p.verdict !== 'AT_RISK') {
    return false
  }
  if (typeof p.httpStatus !== 'number' || Number.isNaN(p.httpStatus)) return false
  if (typeof p.crawlDepth !== 'number') return false
  if (!Array.isArray(p.steps)) return false
  return true
}

/** True when a persisted Index Diagnosis crawl has real fetched pages. */
export function isUsableIndexDiagnosis(
  result: IndexDiagnosisResult | null | undefined,
): boolean {
  if (!isSchemaValidIndexDiagnosis(result)) return false
  const pages = result.pages
  if (pages.length === 0) return false
  if ((result.coverage.fetchedCount ?? 0) < 1) return false
  // At least one page must look like a real HTTP observation.
  return pages.some((p) => typeof p.httpStatus === 'number' && p.httpStatus > 0)
}

/**
 * True when site_audit_results (or equivalent) has a real Quality Gate row —
 * not the zeroed stub the Audit UI used to invent on Index-Diagnosis-only restore.
 */
export function isUsablePageAuditSnapshot(
  snap: PageAuditSnapshot | null | undefined,
): boolean {
  if (!snap) return false
  if (snap.httpStatus > 0) return true
  if (snap.wordCount > 0) return true
  if (snap.score > 0) return true
  if (Array.isArray(snap.issues) && snap.issues.length > 0) return true
  return false
}

export function savedAuditNeedsFreshCrawl(opts: {
  diagnosis: IndexDiagnosisResult | null | undefined
  pageAudit: PageAuditSnapshot | null | undefined
}): { needsFreshCrawl: boolean; reason: string | null } {
  if (!isUsableIndexDiagnosis(opts.diagnosis)) {
    return {
      needsFreshCrawl: true,
      reason: 'Stored Index Diagnosis is empty or incomplete — running a fresh scan.',
    }
  }
  if (!isUsablePageAuditSnapshot(opts.pageAudit)) {
    return {
      needsFreshCrawl: true,
      reason: 'No usable Quality Gate snapshot for this URL — running a fresh scan.',
    }
  }
  return { needsFreshCrawl: false, reason: null }
}

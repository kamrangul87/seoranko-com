/**
 * Mechanical validity for restored Index Diagnosis / page-audit snapshots.
 * Empty or stub rows must never be served as a successful restore.
 */

import type { IndexDiagnosisResult } from './types'

export type PageAuditSnapshot = {
  score: number
  httpStatus: number
  wordCount: number
  issues: unknown[]
  title?: string
  h1?: string
}

/** True when a persisted Index Diagnosis crawl has real fetched pages. */
export function isUsableIndexDiagnosis(
  result: IndexDiagnosisResult | null | undefined,
): boolean {
  if (!result?.coverage) return false
  const pages = result.pages
  if (!Array.isArray(pages) || pages.length === 0) return false
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

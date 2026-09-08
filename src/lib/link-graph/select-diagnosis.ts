import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'

/**
 * Choose which Index Diagnosis payload Link Graph should analyse.
 *
 * A fresh Run (auditId=new / forceFresh) must never silently reuse a
 * client-supplied diagnosis — that object is often a saved/stale crawl
 * still open in the Audit UI after the live site has been fixed.
 */
export function selectDiagnosisForLinkGraphRun(opts: {
  auditId: string
  forceFresh?: boolean
  /** Diagnosis just produced by runIndexDiagnosis (or null if not run). */
  crawled: IndexDiagnosisResult | null
  /** Optional diagnosis from the request body (may be stale). */
  bodyDiagnosis?: IndexDiagnosisResult | null
}): IndexDiagnosisResult | null {
  const freshRequested = opts.auditId === 'new' || opts.forceFresh === true
  if (freshRequested) {
    return opts.crawled
  }
  if (opts.bodyDiagnosis?.htmlByUrl && opts.bodyDiagnosis?.pages) {
    return opts.bodyDiagnosis
  }
  return opts.crawled
}

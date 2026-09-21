/**
 * Classify detector verdicts into the three UI buckets.
 * Matches consolidation-audit / detector convention — no detector changes.
 */

import type { FindingBucket, FindingSurfaceClass } from './types'

export function classifyVerdictBucket(verdict: string): FindingBucket {
  if (
    verdict.startsWith('suppress-') ||
    verdict.startsWith('skip-') ||
    verdict === 'ok' ||
    verdict.startsWith('ok-') ||
    verdict.startsWith('ok/') ||
    verdict.startsWith('route-')
  ) {
    return 'internal'
  }
  if (
    verdict.startsWith('informational-') ||
    verdict === 'informational' ||
    verdict.startsWith('report-sitewide') ||
    verdict.startsWith('metric-') ||
    verdict === 'client_only-limited' ||
    verdict === 'report-client-only-graph'
  ) {
    return 'informational'
  }
  return 'actionable'
}

export function classifySurfaceClass(
  verdict: string,
  opts?: { autoFixable?: boolean; reportOnly?: boolean },
): FindingSurfaceClass {
  const bucket = classifyVerdictBucket(verdict)
  if (bucket === 'internal') return 'internal'
  if (bucket === 'informational') return 'informational'
  if (verdict.startsWith('human-review-') || verdict.startsWith('observation-')) {
    return 'human-review'
  }
  if (
    verdict.startsWith('auto-') ||
    (opts?.autoFixable === true && !opts?.reportOnly)
  ) {
    return 'auto-fixable'
  }
  if (opts?.reportOnly) return 'report-only'
  if (
    verdict.startsWith('finding-') ||
    verdict.startsWith('d17-') ||
    verdict.startsWith('low-') ||
    verdict.startsWith('moderate-') ||
    verdict.startsWith('high-') ||
    verdict.startsWith('critical-') ||
    verdict.startsWith('report-')
  ) {
    return opts?.autoFixable ? 'auto-fixable' : 'finding'
  }
  return opts?.autoFixable ? 'auto-fixable' : 'finding'
}

/** List filter: actionable by default; informational only when toggled on. */
export function isListVisible(
  bucket: FindingBucket,
  opts: { includeInformational: boolean },
): boolean {
  if (bucket === 'internal') return false
  if (bucket === 'informational') return opts.includeInformational
  return true
}

/** Fix button only for auto-fixable (not human-review, not report-only). */
export function canOfferFix(surfaceClass: FindingSurfaceClass): boolean {
  return surfaceClass === 'auto-fixable'
}

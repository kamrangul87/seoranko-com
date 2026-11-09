/**
 * Owner-facing Audit list partitions and counts.
 * Report-only / informational findings are never "Needs you" work.
 */

import { isCurrentlyPresentFindingStatus } from './finding-status'
import type { FindingBucket, FindingSurfaceClass, UiFinding } from './types'

export function isReportOnlyOrInformational(f: {
  bucket?: FindingBucket | string
  reportOnly?: boolean
  surfaceClass?: FindingSurfaceClass | string
  verdict?: string
}): boolean {
  // Human-review always stays in Needs you, even if rollup stamped reportOnly.
  if (f.surfaceClass === 'human-review') return false
  if (typeof f.verdict === 'string' && f.verdict.startsWith('human-review-')) {
    return false
  }
  // Topic 58 weak direction — absence from GSC top rows is not a defect.
  if (f.verdict === 'in-crawl-not-in-gsc-weak') return true
  if (f.reportOnly) return true
  if (f.bucket === 'informational') return true
  if (f.surfaceClass === 'informational' || f.surfaceClass === 'report-only') {
    return true
  }
  return false
}

export function isOwnerActionableFinding(f: {
  bucket?: FindingBucket | string
  reportOnly?: boolean
  surfaceClass?: FindingSurfaceClass | string
  status?: string | null
}): boolean {
  if (f.status && !isCurrentlyPresentFindingStatus(f.status)) return false
  if (isReportOnlyOrInformational(f)) return false
  return f.bucket === 'actionable'
}

export function partitionPresentFindings(findings: UiFinding[]): {
  present: UiFinding[]
  ready: UiFinding[]
  needsYou: UiFinding[]
  accepted: UiFinding[]
  info: UiFinding[]
} {
  const present = findings.filter((f) =>
    isCurrentlyPresentFindingStatus(f.status),
  )
  const ready = present.filter(
    (f) => f.surfaceClass === 'auto-fixable' && !f.fixTypePaused,
  )
  const needsYou = present.filter(
    (f) =>
      !f.acceptedAt &&
      !isReportOnlyOrInformational(f) &&
      (f.fixTypePaused ||
        f.surfaceClass === 'human-review' ||
        f.surfaceClass === 'finding'),
  )
  const accepted = present.filter(
    (f) => Boolean(f.acceptedAt) && f.surfaceClass === 'human-review',
  )
  const info = present.filter((f) => isReportOnlyOrInformational(f))
  return { present, ready, needsYou, accepted, info }
}

export function ownerFacingFindingCounts(input: {
  counts: { actionable: number; informational: number; internal: number }
  findings: Array<{
    bucket?: string
    reportOnly?: boolean
    surfaceClass?: string
    verdict?: string
    status?: string | null
  }>
}): { actionable: number; informational: number; internal: number } {
  const misbucketed = input.findings.filter(
    (f) =>
      isCurrentlyPresentFindingStatus(f.status) &&
      f.bucket === 'actionable' &&
      isReportOnlyOrInformational(f),
  ).length
  return {
    actionable: Math.max(0, input.counts.actionable - misbucketed),
    informational: input.counts.informational + misbucketed,
    internal: input.counts.internal,
  }
}

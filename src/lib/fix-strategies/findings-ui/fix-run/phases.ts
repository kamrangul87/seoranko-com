/**
 * Pure phase / item transition helpers for the one-run Fix Agent.
 * No I/O — unit-tested for single-PR invariant and approval gates.
 */

import type {
  FixRun,
  FixRunItem,
  FixRunItemStatus,
  FixRunPhase,
  FixRunStatus,
  FixRunSummary,
} from './types'

/** Item statuses that still need an apply commit attempt. */
export function itemsNeedingApply(items: FixRunItem[]): FixRunItem[] {
  return items
    .filter((i) => i.status === 'pending')
    .sort((a, b) => a.position - b.position)
}

/** Items committed and awaiting preview verify. */
export function itemsNeedingPreviewVerify(items: FixRunItem[]): FixRunItem[] {
  return items
    .filter((i) => i.status === 'committed')
    .sort((a, b) => a.position - b.position)
}

/** Items preview-verified awaiting production verify after merge. */
export function itemsNeedingProductionVerify(items: FixRunItem[]): FixRunItem[] {
  return items
    .filter((i) => i.status === 'preview_verified')
    .sort((a, b) => a.position - b.position)
}

/** Remaining = not failed and not noop — candidates that reached or can reach preview. */
export function remainingApplyable(items: FixRunItem[]): FixRunItem[] {
  return items.filter((i) => i.status !== 'failed' && i.status !== 'noop')
}

export function allRemainingPreviewVerified(items: FixRunItem[]): boolean {
  const remaining = remainingApplyable(items)
  if (remaining.length === 0) return false
  return remaining.every(
    (i) =>
      i.status === 'preview_verified' ||
      i.status === 'production_verified' ||
      i.status === 'verified_live',
  )
}

export function computeSummary(items: FixRunItem[]): FixRunSummary {
  return {
    total: items.length,
    committed: items.filter((i) =>
      ['committed', 'preview_verified', 'production_verified', 'verified_live'].includes(
        i.status,
      ),
    ).length,
    previewVerified: items.filter((i) =>
      ['preview_verified', 'production_verified', 'verified_live'].includes(i.status),
    ).length,
    verifiedLive: items.filter((i) => i.status === 'verified_live').length,
    failed: items.filter((i) => i.status === 'failed').length,
    noop: items.filter((i) => i.status === 'noop').length,
  }
}

/**
 * Single-PR invariant: one run owns at most one branch and one PR number.
 * Throws (returns false) if items somehow imply multiple PRs — used in tests.
 */
export function assertSinglePrInvariant(run: Pick<FixRun, 'branchName' | 'prNumber' | 'prUrl'>): {
  ok: boolean
  reason?: string
} {
  if (run.prNumber != null && !run.branchName) {
    return { ok: false, reason: 'PR number set without branch' }
  }
  if (run.prUrl && run.prNumber == null) {
    return { ok: false, reason: 'PR URL set without PR number' }
  }
  return { ok: true }
}

/**
 * No merge without approval unless auto_merge_enabled and every gate passes.
 * Pure check — does not perform merge.
 */
export function canMergeRun(input: {
  approvedAt: string | null
  autoMergeEnabled: boolean
  autoMergeGatesPass: boolean
  allPreviewVerified: boolean
}): { allowed: boolean; reason: string } {
  if (!input.allPreviewVerified) {
    return {
      allowed: false,
      reason: 'Not all remaining items are preview-verified',
    }
  }
  if (input.approvedAt) {
    return { allowed: true, reason: 'Human approved' }
  }
  if (input.autoMergeEnabled && input.autoMergeGatesPass) {
    return { allowed: true, reason: 'auto_merge_enabled and all gates passed' }
  }
  if (input.autoMergeEnabled && !input.autoMergeGatesPass) {
    return {
      allowed: false,
      reason: 'auto_merge_enabled but existing gates did not pass — awaiting approval',
    }
  }
  return {
    allowed: false,
    reason: 'No merge without Approve and merge click (auto_merge_enabled is off)',
  }
}

export function nextPhaseAfterApply(items: FixRunItem[]): FixRunPhase {
  if (itemsNeedingApply(items).length > 0) return 'apply_next'
  return 'ensure_pr'
}

export function nextPhaseAfterPreviewVerify(items: FixRunItem[]): FixRunPhase {
  if (itemsNeedingPreviewVerify(items).length > 0) return 'verify_preview_next'
  if (allRemainingPreviewVerified(items)) return 'await_approval'
  // All remaining failed/noop with nothing to verify
  const anyCommittedOrBetter = remainingApplyable(items).some((i) =>
    ['committed', 'preview_verified', 'production_verified', 'verified_live'].includes(
      i.status,
    ),
  )
  if (!anyCommittedOrBetter) return 'done'
  return 'await_approval'
}

export function nextPhaseAfterProductionVerify(items: FixRunItem[]): FixRunPhase {
  if (itemsNeedingProductionVerify(items).length > 0) {
    return 'verify_production_next'
  }
  return 'recrawl'
}

export function progressLabel(run: Pick<FixRun, 'status' | 'phase' | 'items'>): string {
  const s = computeSummary(run.items)
  switch (run.phase) {
    case 'create_branch':
      return 'Creating review branch…'
    case 'apply_next':
      return `Applying fixes (${s.committed + s.failed + s.noop}/${s.total})…`
    case 'ensure_pr':
      return 'Opening pull request…'
    case 'wait_preview':
      return 'Waiting for preview deploy…'
    case 'verify_preview_next':
      return `Verifying preview (${s.previewVerified}/${s.committed})…`
    case 'await_approval':
      return 'Awaiting approval to merge'
    case 'merge':
      return 'Merging pull request…'
    case 'verify_production_next':
      return `Verifying production (${s.verifiedLive}/${s.previewVerified})…`
    case 'recrawl':
      return 'Recrawling site…'
    case 'done':
      return run.status === 'complete' ? 'Complete' : 'Finished with failures'
    default:
      return run.phase
  }
}

export function itemUiStep(status: FixRunItemStatus): string {
  switch (status) {
    case 'pending':
      return 'Queued'
    case 'applying':
      return 'Applying'
    case 'committed':
      return 'PR open'
    case 'preview_verified':
      return 'Preview verified'
    case 'failed':
      return 'Failed'
    case 'production_verified':
      return 'Merged'
    case 'verified_live':
      return 'Verified live'
    case 'noop':
      return 'No change'
    default:
      return status
  }
}

/** Mark item failed — used by isolation tests. */
export function markItemFailed(
  item: FixRunItem,
  reason: string,
  now = new Date().toISOString(),
): FixRunItem {
  return {
    ...item,
    status: 'failed',
    failureReason: reason,
    updatedAt: now,
  }
}

export function markItemCommitted(
  item: FixRunItem,
  commitSha: string,
  path: string,
  now = new Date().toISOString(),
): FixRunItem {
  return {
    ...item,
    status: 'committed',
    commitSha,
    path,
    failureReason: null,
    updatedAt: now,
  }
}

export function deriveRunStatus(
  phase: FixRunPhase,
  items: FixRunItem[],
  errorDetail?: string | null,
): FixRunStatus {
  if (phase === 'done') {
    // Terminal failure before any item progressed (e.g. create_branch / ensure_pr).
    if (errorDetail) return 'failed'
    const s = computeSummary(items)
    if (s.verifiedLive > 0 || s.previewVerified > 0 || s.committed > 0) {
      return 'complete'
    }
    if (s.failed === s.total && s.total > 0) return 'failed'
    return 'complete'
  }
  if (phase === 'await_approval') return 'awaiting_approval'
  if (phase === 'merge') return 'merging'
  if (phase === 'create_branch' && items.every((i) => i.status === 'pending')) {
    return 'queued'
  }
  return 'running'
}

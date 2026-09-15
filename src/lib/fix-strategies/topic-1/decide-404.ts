import type { GitDeletionEvidence } from './git-route-history'
import type { SuccessorCandidate } from './successor-similarity'

/**
 * Topic 1 — 404 branch decision tree (dossier fix router).
 *
 * Outcomes:
 * - remove-anchor (auto) — git deletion evidence and zero successors
 * - proposed-301 (human-review) — exactly one successor above the floor
 * - ambiguous-successors (human-review) — two or more successors
 * - history-unavailable (human-review) — git history cannot be trusted for a
 *   negative result (shallow clone, failed git, missing runner). Never treated
 *   as recreate-scaffold or auto remove-anchor.
 * - recreate-scaffold (human-review) — history available, no deletion found,
 *   and no successors
 *
 * GSC impressions are connection-required enrichment and must not gate.
 */

export type Decision404 =
  | {
      verdict: 'auto-fixable'
      action: 'remove-anchor'
      reason: string
      git: GitDeletionEvidence
      successors: SuccessorCandidate[]
    }
  | {
      verdict: 'human-review'
      action:
        | 'proposed-301'
        | 'ambiguous-successors'
        | 'history-unavailable'
        | 'recreate-scaffold'
      reason: string
      git: GitDeletionEvidence
      successors: SuccessorCandidate[]
    }

export function decide404Branch(input: {
  git: GitDeletionEvidence
  successors: SuccessorCandidate[]
  /** Present when GSC is connected; ignored for gating. */
  gscImpressions?: number | null
}): Decision404 {
  const { git, successors } = input
  // gscImpressions intentionally unused for gating — connection-required only.

  if (successors.length === 1) {
    return {
      verdict: 'human-review',
      action: 'proposed-301',
      reason: `exactly one successor above floor: ${successors[0]!.path}`,
      git,
      successors,
    }
  }

  if (successors.length >= 2) {
    return {
      verdict: 'human-review',
      action: 'ambiguous-successors',
      reason: `${successors.length} successors above floor — no tie-break`,
      git,
      successors,
    }
  }

  // Zero successors — git evidence status decides. history-unavailable must
  // never fall through to recreate-scaffold or auto remove-anchor.
  if (git.status === 'history-unavailable') {
    return {
      verdict: 'human-review',
      action: 'history-unavailable',
      reason: git.detail,
      git,
      successors,
    }
  }

  if (git.status === 'deleted' || git.deleted) {
    return {
      verdict: 'auto-fixable',
      action: 'remove-anchor',
      reason: `git deletion evidence and no successor: ${git.detail}`,
      git,
      successors,
    }
  }

  // status === 'no-deletion-found'
  return {
    verdict: 'human-review',
    action: 'recreate-scaffold',
    reason:
      'no git deletion evidence and no successor — destination may still be intended',
    git,
    successors,
  }
}

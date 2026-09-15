import type { GitDeletionEvidence } from './git-route-history'
import type { SuccessorCandidate } from './successor-similarity'
import type { RouteKind } from '@/lib/fix-strategies/site-model'

/**
 * Topic 1 — 404 branch decision tree (dossier fix router).
 *
 * Outcomes:
 * - remove-anchor (auto) — git deletion evidence and zero successors
 * - proposed-301 (human-review) — exactly one successor above the floor
 * - ambiguous-successors (human-review) — two or more successors
 * - history-unavailable (human-review) — git history cannot be trusted for a
 *   negative result. Never treated as recreate-scaffold or auto remove-anchor.
 * - no-action (human-review) — site model says no-route and git says
 *   no-deletion-found. Intent is unknown; propose nothing (guard 9).
 * - recreate-scaffold (human-review) — only when there is positive evidence the
 *   route existed/should exist (site model static/dynamic route) and git found
 *   no deletion, with zero successors.
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
      routeKind: RouteKind | null
    }
  | {
      verdict: 'human-review'
      action:
        | 'proposed-301'
        | 'ambiguous-successors'
        | 'history-unavailable'
        | 'no-action'
        | 'recreate-scaffold'
      reason: string
      git: GitDeletionEvidence
      successors: SuccessorCandidate[]
      routeKind: RouteKind | null
    }

export function decide404Branch(input: {
  git: GitDeletionEvidence
  successors: SuccessorCandidate[]
  /** Site-model resolution for the target path. */
  routeKind?: RouteKind | null
  /** Present when GSC is connected; ignored for gating. */
  gscImpressions?: number | null
}): Decision404 {
  const { git, successors } = input
  const routeKind = input.routeKind ?? null
  // gscImpressions intentionally unused for gating — connection-required only.

  if (successors.length === 1) {
    return {
      verdict: 'human-review',
      action: 'proposed-301',
      reason: `exactly one successor above floor: ${successors[0]!.path}`,
      git,
      successors,
      routeKind,
    }
  }

  if (successors.length >= 2) {
    return {
      verdict: 'human-review',
      action: 'ambiguous-successors',
      reason: `${successors.length} successors above floor — no tie-break`,
      git,
      successors,
      routeKind,
    }
  }

  // Zero successors — git evidence × site-model route kind.
  if (git.status === 'history-unavailable') {
    return {
      verdict: 'human-review',
      action: 'history-unavailable',
      reason: git.detail,
      git,
      successors,
      routeKind,
    }
  }

  if (git.status === 'deleted' || git.deleted) {
    return {
      verdict: 'auto-fixable',
      action: 'remove-anchor',
      reason: `git deletion evidence and no successor: ${git.detail}`,
      git,
      successors,
      routeKind,
    }
  }

  // status === 'no-deletion-found'
  // Guard 9: no-route + no deletion history ⇒ intent unknown ⇒ propose nothing.
  if (routeKind === 'no-route' || routeKind == null || routeKind === 'indeterminate') {
    return {
      verdict: 'human-review',
      action: 'no-action',
      reason:
        routeKind === 'no-route'
          ? 'no-route in site model and no git deletion evidence — intent unknown; propose nothing'
          : 'no git deletion evidence and route kind unknown/indeterminate — propose nothing',
      git,
      successors,
      routeKind,
    }
  }

  // Positive evidence the route exists in the repo (static/dynamic) but live
  // 404 with no deletion record → destination should exist; scaffold for review.
  return {
    verdict: 'human-review',
    action: 'recreate-scaffold',
    reason: `site model resolves ${routeKind} with no git deletion — destination may still be intended`,
    git,
    successors,
    routeKind,
  }
}

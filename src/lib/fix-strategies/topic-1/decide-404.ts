import type { GitDeletionEvidence } from './git-route-history'
import type { SuccessorCandidate } from './successor-similarity'
import type { RouteKind } from '@/lib/fix-strategies/site-model'

/**
 * Topic 1 — 404 branch decision tree (dossier fix router / topic 41).
 *
 * Outcomes:
 * - remove-anchor (auto) — git deletion evidence and zero successors
 * - proposed-301 (human-review) — exactly one successor above the floor
 * - ambiguous-successors (human-review) — two or more successors
 * - history-unavailable (human-review) — git history cannot be trusted for a
 *   negative result. Never treated as recreate-scaffold or auto remove-anchor.
 * - no-action (human-review) — guard 9: no deletion evidence and zero
 *   successors, when site-model does not prove the *resource* should exist
 *   (`no-route` / indeterminate / unknown, **or** `dynamic-route` pattern
 *   match only). A dynamic pattern matching `/blog/[slug]` does not prove
 *   `/blog/missing-post` was intended — proposing scaffold would invent
 *   intent (and for soft-404 would imply slug content generation).
 * - recreate-scaffold (human-review) — only when there is positive evidence
 *   the *exact* resource should exist: site model `static-route` (exact page
 *   file for this path) with no deletion and zero successors. Never from a
 *   dynamic pattern alone. Scaffold = empty route stub proposal label only;
 *   this module does not emit files or page copy.
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
  // Guard 9: absence of deletion evidence does not establish intent.
  // Dynamic pattern match proves a route *pattern*, not that this slug/resource
  // should exist (topic 70 / soft-404 discriminator lesson). Never scaffold.
  if (
    routeKind === 'no-route' ||
    routeKind == null ||
    routeKind === 'indeterminate' ||
    routeKind === 'dynamic-route'
  ) {
    const reason =
      routeKind === 'dynamic-route'
        ? 'dynamic-route pattern matches but no slug-specific deletion evidence — resource intent unknown; propose nothing (guard 9)'
        : routeKind === 'no-route'
          ? 'no-route in site model and no git deletion evidence — intent unknown; propose nothing'
          : 'no git deletion evidence and route kind unknown/indeterminate — propose nothing'
    return {
      verdict: 'human-review',
      action: 'no-action',
      reason,
      git,
      successors,
      routeKind,
    }
  }

  // static-route: exact page file exists for this path — positive site-model
  // evidence the resource should exist; live miss with no deletion → scaffold
  // proposal for human review (empty stub label only — no content generation).
  return {
    verdict: 'human-review',
    action: 'recreate-scaffold',
    reason: `site model resolves static-route with no git deletion — destination may still be intended`,
    git,
    successors,
    routeKind,
  }
}

/**
 * Topic 17 — classify multiple rel=canonical declarations.
 *
 * C12 stays SCOPED ("likely ignores all" — outdated-content warning).
 * Never keep the first by document order.
 */

import {
  distinctNormalizedTargets,
  type CanonicalDeclaration,
} from '@/lib/fix-strategies/shared'

export type Topic17Verdict =
  | 'ok'
  | 'auto-collapse-redundant'
  | 'auto-remove-body-misplaced'
  | 'human-review-conflicting'
  | 'human-review-multi-site'
  | 'route-topic-16'

export type ClassifyTopic17Input = {
  /** All document (head+body) declarations. */
  documentDecls: CanonicalDeclaration[]
  /** Header-only pairing with single HTML → topic 16. */
  headerCount: number
  /** Both page and layout declare canonical in repo. */
  multiRepoSites: boolean
  repoSites: string[]
}

export type ClassifyTopic17Result = {
  verdict: Topic17Verdict
  detail: string
  distinctTargets: string[]
  scopedOutcomeNote: string | null
  /** Surviving target for redundant collapse — NOT first-by-order; the sole normalised value. */
  collapseTo: string | null
}

const SCOPED_C12 =
  'Multiple declarations: Google will likely ignore all of them (C12 — outdated-content warning on source; "likely", not "always")'

export function classifyMultipleCanonicals(
  input: ClassifyTopic17Input,
): ClassifyTopic17Result {
  const head = input.documentDecls.filter((d) => d.location === 'head')
  const body = input.documentDecls.filter((d) => d.location === 'body')
  const docCount = input.documentDecls.length

  // Guard 2: one head + header only → topic 16
  if (head.length === 1 && body.length === 0 && input.headerCount >= 1 && docCount === 1) {
    return {
      verdict: 'route-topic-16',
      detail:
        'One HTML canonical plus header — topic 16, not multiple-tags (guard 2)',
      distinctTargets: distinctNormalizedTargets(head),
      scopedOutcomeNote: null,
      collapseTo: null,
    }
  }

  // Page + layout both declare — report both sites (fixing one is insufficient)
  if (input.multiRepoSites) {
    return {
      verdict: 'human-review-multi-site',
      detail: `Multiple declaration sites in repo: ${input.repoSites.join(', ')} — fixing one is insufficient`,
      distinctTargets: distinctNormalizedTargets(input.documentDecls),
      scopedOutcomeNote: SCOPED_C12,
      collapseTo: null,
    }
  }

  if (docCount <= 1 && body.length === 0) {
    return {
      verdict: 'ok',
      detail: 'At most one document canonical — suppressed',
      distinctTargets: distinctNormalizedTargets(input.documentDecls),
      scopedOutcomeNote: null,
      collapseTo: null,
    }
  }

  // Misplaced body (alone or with head)
  if (body.length > 0 && head.length <= 1) {
    const targets = distinctNormalizedTargets(input.documentDecls)
    if (head.length === 0 && body.length === 1) {
      return {
        verdict: 'auto-remove-body-misplaced',
        detail:
          'Canonical in <body> only — Google disregards it (C2); remove (no-op to served signal)',
        distinctTargets: targets,
        scopedOutcomeNote: null,
        collapseTo: null,
      }
    }
    if (head.length === 1 && body.length >= 1) {
      // Body is disregarded; if head is single, removing body is auto-safe
      return {
        verdict: 'auto-remove-body-misplaced',
        detail:
          'Head has one canonical; body declaration(s) disregarded (C2) — remove body',
        distinctTargets: targets,
        scopedOutcomeNote: targets.length > 1 ? SCOPED_C12 : null,
        collapseTo: head[0]!.normalized,
      }
    }
  }

  const targets = distinctNormalizedTargets(input.documentDecls)

  if (targets.length <= 1 && docCount >= 2) {
    // Redundant — all same normalised target. Collapse; do NOT pick "first".
    return {
      verdict: 'auto-collapse-redundant',
      detail:
        'Multiple declarations normalise to the same target — collapse to one (redundant)',
      distinctTargets: targets,
      scopedOutcomeNote: null,
      collapseTo: targets[0] ?? null,
    }
  }

  if (targets.length >= 2) {
    return {
      verdict: 'human-review-conflicting',
      detail:
        'Multiple distinct normalised canonical targets — conflicting; surviving target is intent (never keep first by document order)',
      distinctTargets: targets,
      scopedOutcomeNote: SCOPED_C12,
      collapseTo: null,
    }
  }

  return {
    verdict: 'ok',
    detail: 'No multiple-declaration finding',
    distinctTargets: targets,
    scopedOutcomeNote: null,
    collapseTo: null,
  }
}

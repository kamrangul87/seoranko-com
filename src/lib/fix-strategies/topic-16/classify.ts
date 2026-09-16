/**
 * Topic 16 — classify HTML vs HTTP Link header canonical disagreement.
 *
 * C12 ("likely ignores all") stays SCOPED — outdated-content warning on source.
 */

export type Topic16Verdict =
  | 'ok'
  | 'informational-redundant'
  | 'finding-conflict'
  | 'auto-remove-header-single-route'
  | 'human-review-conflict'
  | 'indeterminate-header-scope'
  | 'route-topic-14'
  | 'route-topic-17'
  | 'suppress-non-html'
  | 'suppress-header-only-ok'

export type ClassifyTopic16Input = {
  hasHead: boolean
  hasHeader: boolean
  /** Multiple HTML head canonicals. */
  multipleHead: boolean
  headTarget: string | null
  headerTarget: string | null
  targetsEqual: boolean
  isNonHtml: boolean
  /** Either target known non-200 / noindex — handle 14/15 first. */
  eitherTargetUnhealthy: boolean
  headerScope:
    | 'single-route'
    | 'multi-route'
    | 'indeterminate'
    | 'not-found'
  /** HTML matches preferred form from topics 8–12 (when known). */
  htmlMatchesPreferred: boolean | null
}

export type ClassifyTopic16Result = {
  verdict: Topic16Verdict
  detail: string
  /**
   * Scoped note — do not state "Google always ignores all" (C12 outdated).
   */
  scopedOutcomeNote: string | null
}

const SCOPED_C12 =
  'Where declarations conflict, Google will likely ignore them (C12 — source carries outdated-content warning; "likely", not "always")'

export function classifyHtmlHeaderCanonicalDisagree(
  input: ClassifyTopic16Input,
): ClassifyTopic16Result {
  if (input.multipleHead) {
    return {
      verdict: 'route-topic-17',
      detail: 'Multiple HTML canonicals — topic 17, not this finding (guard 6)',
      scopedOutcomeNote: null,
    }
  }

  if (input.isNonHtml) {
    if (input.hasHeader && !input.hasHead) {
      return {
        verdict: 'suppress-non-html',
        detail:
          'Non-HTML resource — header is the correct method (guard 4 / C7)',
        scopedOutcomeNote: null,
      }
    }
    return {
      verdict: 'suppress-non-html',
      detail: 'Non-HTML — HTML/header disagreement not assessed as HTML fix',
      scopedOutcomeNote: null,
    }
  }

  if (!input.hasHead || !input.hasHeader) {
    return {
      verdict: input.hasHeader && !input.hasHead ? 'suppress-header-only-ok' : 'ok',
      detail: !input.hasHead && !input.hasHeader
        ? 'No declarations — not topic 16'
        : input.hasHeader
          ? 'Header only — not a disagreement'
          : 'HTML only — not a disagreement',
      scopedOutcomeNote: null,
    }
  }

  if (input.eitherTargetUnhealthy) {
    return {
      verdict: 'route-topic-14',
      detail: 'A target is non-200 or noindexed — topics 14/15 first (guard 5)',
      scopedOutcomeNote: null,
    }
  }

  if (input.targetsEqual) {
    return {
      verdict: 'informational-redundant',
      detail:
        'HTML and header declare the same normalised target — redundant, not conflicting (guard 1)',
      scopedOutcomeNote: null,
    }
  }

  // Conflict
  if (
    input.headerScope === 'indeterminate' ||
    input.headerScope === 'not-found' ||
    input.headerScope === 'multi-route'
  ) {
    return {
      verdict: 'indeterminate-header-scope',
      detail:
        input.headerScope === 'multi-route'
          ? 'HTML/header conflict but header rule covers many routes — resolve scope before removal (topic 70)'
          : 'HTML/header conflict but header scope not statically resolvable — indeterminate (guard 3)',
      scopedOutcomeNote: SCOPED_C12,
    }
  }

  // single-route
  if (input.htmlMatchesPreferred === true) {
    return {
      verdict: 'auto-remove-header-single-route',
      detail:
        'Conflict; header scoped to this single route; HTML matches preferred form — remove header',
      scopedOutcomeNote: SCOPED_C12,
    }
  }

  return {
    verdict: 'human-review-conflict',
    detail:
      'HTML/header conflict on a single-route header — which declaration is correct is intent',
    scopedOutcomeNote: SCOPED_C12,
  }
}

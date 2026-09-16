/**
 * Topic 7 — redirect target not 200.
 *
 * Does NOT reimplement terminal classification — callers pass results from
 * topic 68 (4xx), topic 3 (5xx), topic 2a (injected noindex), topic 70
 * (declared noindex).
 *
 * Auto-repointing to the homepage is REJECTED.
 */

import type { ChainWalkResult } from './walk'

export type Topic7Verdict =
  | 'ok'
  | 'finding-terminal-4xx'
  | 'finding-soft-404-injected'
  | 'route-topic-3-transient-5xx'
  | 'route-topic-3-persistent-5xx'
  | 'suppress-repo-declared-noindex'
  | 'potential-soft-404-2b'
  | 'human-review-temporary-to-unavailable'
  | 'route-topic-4-max-hops'
  | 'route-topic-5-loop'
  | 'indeterminate-middleware'
  | 'auto-remove-static-4xx'
  | 'human-review-repoint-or-remove'
  | 'reject-homepage-repoint'

export type TerminalClassification = {
  /** Confirmed 4xx per topic 68. */
  confirmed4xx?: boolean
  /** Transient 5xx → topic 3. */
  transient5xx?: boolean
  /** Persistent 5xx per topic 3 window. */
  persistent5xx?: boolean
  /** 200 + noindex, repo declares it (topic 70). */
  repoDeclaredNoindex?: boolean
  /** 200 + injected noindex, not repo-declared (topic 2a). */
  injectedNoindexSoft404?: boolean
  /** Unprovable soft-404 (2b). */
  soft404Unprovable2b?: boolean
}

export type ClassifyTopic7Input = {
  chain: ChainWalkResult
  terminal: TerminalClassification
  middlewareIndeterminate?: boolean
  /** 302/307 to a temporarily unavailable target. */
  temporaryToUnavailable?: boolean
  /** Plain static redirect rule + confirmed 4xx + no successor. */
  autoRemoveEligible?: boolean
  /** Proposed repoint target is the homepage — REJECTED. */
  proposedHomepageRepoint?: boolean
}

export type ClassifyTopic7Result = {
  verdict: Topic7Verdict
  detail: string
  autoFixable: boolean
}

export function classifyRedirectTargetNot200(
  input: ClassifyTopic7Input,
): ClassifyTopic7Result {
  const { chain, terminal } = input

  if (chain.stoppedReason === 'repeat-url') {
    return {
      verdict: 'route-topic-5-loop',
      detail: 'Chain loops before terminal — topic 5',
      autoFixable: false,
    }
  }

  if (chain.stoppedReason === 'max-hops') {
    return {
      verdict: 'route-topic-4-max-hops',
      detail: 'Exceeded 10 hops before terminal — topic 4',
      autoFixable: false,
    }
  }

  if (chain.redirectHopCount === 0) {
    return {
      verdict: 'ok',
      detail: 'No redirect',
      autoFixable: false,
    }
  }

  if (chain.stoppedReason === 'missing-location') {
    // Not a terminal classification — chain never reached a target
    return {
      verdict: 'ok',
      detail: 'Missing Location — not a terminal-target finding (topic 5)',
      autoFixable: false,
    }
  }

  if (chain.finalStatus === 200) {
    if (terminal.repoDeclaredNoindex) {
      return {
        verdict: 'suppress-repo-declared-noindex',
        detail: 'Terminal 200 with repo-declared noindex — deliberate exclusion',
        autoFixable: false,
      }
    }
    if (terminal.injectedNoindexSoft404) {
      return {
        verdict: 'finding-soft-404-injected',
        detail: 'Terminal 200 with injected noindex (topic 2a soft-404)',
        autoFixable: false,
      }
    }
    if (terminal.soft404Unprovable2b) {
      return {
        verdict: 'potential-soft-404-2b',
        detail: 'Potential soft-404 (2b) — report only, never auto-fix',
        autoFixable: false,
      }
    }
    return {
      verdict: 'ok',
      detail: 'Terminal 200 — healthy',
      autoFixable: false,
    }
  }

  if (input.middlewareIndeterminate) {
    return {
      verdict: 'indeterminate-middleware',
      detail: 'Hop from middleware — indeterminate (topic 70)',
      autoFixable: false,
    }
  }

  // Temporary redirect to a temporarily unavailable target — before 5xx routing
  if (input.temporaryToUnavailable) {
    return {
      verdict: 'human-review-temporary-to-unavailable',
      detail: 'Temporary redirect to temporarily unavailable target — human-review',
      autoFixable: false,
    }
  }

  if (terminal.transient5xx) {
    return {
      verdict: 'route-topic-3-transient-5xx',
      detail: 'Transient 5xx on terminal — topic 3 availability, not this finding',
      autoFixable: false,
    }
  }

  if (terminal.persistent5xx) {
    return {
      verdict: 'route-topic-3-persistent-5xx',
      detail: 'Persistent 5xx on terminal — topic 3',
      autoFixable: false,
    }
  }

  if (input.proposedHomepageRepoint) {
    return {
      verdict: 'reject-homepage-repoint',
      detail:
        'REJECTED: auto-repointing to the homepage creates a soft-404 pattern',
      autoFixable: false,
    }
  }

  if (terminal.confirmed4xx) {
    if (input.autoRemoveEligible) {
      return {
        verdict: 'auto-remove-static-4xx',
        detail:
          'Confirmed 4xx terminal, static redirect, no successor — remove redirect',
        autoFixable: true,
      }
    }
    return {
      verdict: 'finding-terminal-4xx',
      detail: `Redirect resolves to confirmed ${chain.finalStatus} — human-review repoint vs remove`,
      autoFixable: false,
    }
  }

  // Non-200 without classified terminal — still a finding for review
  if (chain.finalStatus < 200 || chain.finalStatus >= 300) {
    return {
      verdict: 'human-review-repoint-or-remove',
      detail: `Terminal status ${chain.finalStatus} — classify via topics 68/3/2a/70`,
      autoFixable: false,
    }
  }

  return {
    verdict: 'ok',
    detail: 'No redirect-target finding',
    autoFixable: false,
  }
}

/** Rejected transform — never repoint to homepage. */
export function rejectedHomepageRepoint(): never {
  throw new Error(
    'REJECTED: auto-repointing a redirect to the homepage creates a soft-404 pattern',
  )
}

/**
 * Topic 4 — classify redirect chains from a ChainWalkResult.
 *
 * Severity and auto-fixability are independent (same correction as topic 42).
 */

import type { ChainWalkResult } from './walk'

export type Topic4Severity = 'moderate' | 'high' | 'hard-failure' | null

export type Topic4Verdict =
  | 'ok-single-hop'
  | 'ok-no-redirect'
  | 'finding-chain-moderate'
  | 'finding-chain-high'
  | 'hard-failure-over-10'
  | 'route-topic-5-loop'
  | 'route-topic-5-missing-location'
  | 'route-topic-7-terminal-not-200'
  | 'indeterminate-middleware'
  | 'human-review-intermediate-work'
  | 'auto-collapse-static'
  | 'human-review-collapse'
  | 'skip-external'

export type ClassifyTopic4Input = {
  chain: ChainWalkResult
  /** Middleware hop — topic 70 indeterminate. */
  middlewareIndeterminate?: boolean
  /** Intermediate hop does locale/auth/A-B work — never collapse. */
  intermediateDoesWork?: boolean
  /** Every hop is a plain static redirect in repo config. */
  allHopsStaticInRepo?: boolean
  /** Final target confirmed 200 on re-fetch. */
  finalConfirmed200?: boolean
  /** External host redirect — out of scope. */
  externalRedirect?: boolean
}

export type ClassifyTopic4Result = {
  verdict: Topic4Verdict
  severity: Topic4Severity
  /** Independent of verdict — quality band from hop count. */
  hopCount: number
  detail: string
  autoFixable: boolean
}

/**
 * Severity from hop count (N15 + Googlebot 10 hard limit).
 * Independent of whether we auto-fix.
 */
export function severityForChainHops(hops: number): Topic4Severity {
  if (hops <= 1) return null
  if (hops <= 3) return 'moderate'
  if (hops <= 10) return 'high'
  return 'hard-failure'
}

export function classifyRedirectChain(
  input: ClassifyTopic4Input,
): ClassifyTopic4Result {
  const { chain } = input
  const hops = chain.redirectHopCount

  if (chain.missingLocation) {
    return {
      verdict: 'route-topic-5-missing-location',
      severity: null,
      hopCount: hops,
      detail: '3xx with no Location — topic 5 separate finding',
      autoFixable: false,
    }
  }

  if (chain.stoppedReason === 'repeat-url') {
    return {
      verdict: 'route-topic-5-loop',
      severity: null,
      hopCount: hops,
      detail: 'Chain revisits a URL — topic 5 (loop), not a chain finding',
      autoFixable: false,
    }
  }

  if (chain.stoppedReason === 'max-hops' || hops > 10) {
    return {
      verdict: 'hard-failure-over-10',
      severity: 'hard-failure',
      hopCount: hops,
      detail:
        'More than 10 redirect hops — Google abandons; destination never reached',
      autoFixable: false,
    }
  }

  if (hops === 0) {
    return {
      verdict: 'ok-no-redirect',
      severity: null,
      hopCount: 0,
      detail: 'No redirect',
      autoFixable: false,
    }
  }

  if (hops === 1) {
    // Direct redirect — not this finding. Terminal not 200 → topic 7.
    if (chain.finalStatus !== 200 && chain.stoppedReason === 'non-3xx') {
      return {
        verdict: 'route-topic-7-terminal-not-200',
        severity: null,
        hopCount: 1,
        detail: 'Single hop but terminal is not 200 — topic 7',
        autoFixable: false,
      }
    }
    return {
      verdict: 'ok-single-hop',
      severity: null,
      hopCount: 1,
      detail: 'Direct redirect — not a chain',
      autoFixable: false,
    }
  }

  // hops >= 2
  if (
    chain.stoppedReason === 'non-3xx' &&
    chain.finalStatus !== 200
  ) {
    return {
      verdict: 'route-topic-7-terminal-not-200',
      severity: severityForChainHops(hops),
      hopCount: hops,
      detail: 'Chain ends at non-200 — topic 7, not this finding',
      autoFixable: false,
    }
  }

  if (input.externalRedirect) {
    return {
      verdict: 'skip-external',
      severity: severityForChainHops(hops),
      hopCount: hops,
      detail: 'External redirect — out of scope',
      autoFixable: false,
    }
  }

  if (input.middlewareIndeterminate) {
    return {
      verdict: 'indeterminate-middleware',
      severity: severityForChainHops(hops),
      hopCount: hops,
      detail: 'Hop produced by middleware — indeterminate (topic 70)',
      autoFixable: false,
    }
  }

  if (input.intermediateDoesWork) {
    return {
      verdict: 'human-review-intermediate-work',
      severity: severityForChainHops(hops),
      hopCount: hops,
      detail: 'Intermediate hop performs work — never collapse',
      autoFixable: false,
    }
  }

  const severity = severityForChainHops(hops)
  const bandDetail =
    hops <= 3
      ? 'within Google\'s "ideally no more than 3" (N15)'
      : hops < 5
        ? 'beyond ideal, approaching "fewer than 5" (N15)'
        : 'outside soft advice; still followed up to 10'

  const canAuto =
    input.allHopsStaticInRepo === true && input.finalConfirmed200 === true

  return {
    verdict: canAuto ? 'auto-collapse-static' : 'human-review-collapse',
    severity,
    hopCount: hops,
    detail: `${hops}-hop chain (${bandDetail}) — ${canAuto ? 'auto-collapse static redirects' : 'human-review (default)'}`,
    autoFixable: canAuto,
  }
}

/**
 * Topic 5 — loops, self-redirects, and missing Location.
 *
 * Loops: visited-set membership (not consecutive). Normalisation must not
 * collapse slash/case/query/port — those are topics 8/11.
 */

import type { ChainWalkResult } from './walk'

export type Topic5Verdict =
  | 'ok'
  | 'finding-loop'
  | 'finding-self-redirect'
  | 'finding-missing-location'
  | 'route-topic-4-max-hops'
  | 'route-topic-8-trailing-slash-bounce'
  | 'indeterminate-middleware'
  | 'human-review-stateful'

export type ClassifyTopic5Input = {
  chain: ChainWalkResult
  middlewareIndeterminate?: boolean
  /** Loop depends on cookie/session/auth/geo. */
  statefulDependency?: boolean
}

export type ClassifyTopic5Result = {
  verdict: Topic5Verdict
  detail: string
  cycle: string[] | null
}

export function classifyRedirectLoop(
  input: ClassifyTopic5Input,
): ClassifyTopic5Result {
  const { chain } = input

  if (chain.missingLocation) {
    return {
      verdict: 'finding-missing-location',
      detail:
        '3xx with no Location header — protocol error; chain cannot continue (not a loop)',
      cycle: null,
    }
  }

  if (chain.stoppedReason === 'max-hops' && !chain.cycle) {
    return {
      verdict: 'route-topic-4-max-hops',
      detail: 'Exceeded 10 hops without repeating a URL — topic 4, not a loop',
      cycle: null,
    }
  }

  if (chain.stoppedReason !== 'repeat-url') {
    // Trailing-slash bounce /page → /page/ is NOT a loop (guard 1).
    // If we have a single hop between slash variants ending at 200, ok here.
    return {
      verdict: 'ok',
      detail: 'No visited-set repeat',
      cycle: null,
    }
  }

  if (input.middlewareIndeterminate) {
    return {
      verdict: 'indeterminate-middleware',
      detail: 'Loop hop from middleware — indeterminate (topic 70)',
      cycle: chain.cycle,
    }
  }

  if (input.statefulDependency) {
    return {
      verdict: 'human-review-stateful',
      detail: 'Loop may depend on cookie/session/auth/geo — human-review',
      cycle: chain.cycle,
    }
  }

  if (chain.selfRedirect) {
    return {
      verdict: 'finding-self-redirect',
      detail: `Self-redirect: ${chain.cycle?.join(' → ') ?? chain.originUrl}`,
      cycle: chain.cycle,
    }
  }

  return {
    verdict: 'finding-loop',
    detail: `Redirect loop (visited-set): ${(chain.cycle ?? []).join(' → ')}`,
    cycle: chain.cycle,
  }
}

/**
 * True when the only "repeat" would require collapsing slash/case — i.e. the
 * chain is a trailing-slash bounce, not a loop. Used by fixtures/guards.
 */
export function isTrailingSlashBounceOnly(chain: ChainWalkResult): boolean {
  if (chain.redirectHopCount !== 1) return false
  const hop = chain.hops[0]
  if (!hop?.location) return false
  try {
    const a = new URL(hop.url)
    const b = new URL(hop.location)
    if (a.origin !== b.origin) return false
    if (a.search !== b.search) return false
    const pa = a.pathname.replace(/\/$/, '') || '/'
    const pb = b.pathname.replace(/\/$/, '') || '/'
    // Same path ignoring trailing slash, and one has slash the other doesn't
    return (
      pa === pb &&
      a.pathname !== b.pathname &&
      (a.pathname.endsWith('/') !== b.pathname.endsWith('/'))
    )
  } catch {
    return false
  }
}

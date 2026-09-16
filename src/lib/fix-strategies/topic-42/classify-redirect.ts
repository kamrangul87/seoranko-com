/**
 * Topic 42 — classify a recorded redirect chain for an internal link target.
 */

import type { HopRecordingResult } from '@/lib/fix-strategies/shared'
import {
  extractHtmlCanonical,
  hasNoindexDirective,
  isSelfCanonical,
  normalizeFixStrategyUrl,
  preserveQueryAndFragment,
  wouldDropQueryOrFragment,
} from '@/lib/fix-strategies/shared'

export type RedirectSeverity = 'low' | 'moderate' | 'high'

export type Topic42Verdict =
  | 'auto-rewrite'
  | 'human-review-temporary-redirect'
  | 'human-review-conditional-redirect'
  | 'human-review-shared-nav'
  | 'human-review-not-canonical'
  | 'human-review-would-drop-query-or-fragment'
  | 'human-review-unstable'
  | 'route-topic-4-long-chain'
  | 'route-topic-5-loop'
  | 'route-topic-1-non-200'
  | 'skip-not-redirect'
  | 'skip-external-destination'

export function redirectHopCount(chain: HopRecordingResult): number {
  return chain.hops.filter((h) => h.status >= 300 && h.status < 400).length
}

export function severityForHopCount(hops: number): RedirectSeverity {
  if (hops <= 1) return 'low'
  if (hops <= 3) return 'moderate'
  return 'high'
}

function isStableRedirectStatus(status: number): boolean {
  return status === 301 || status === 308
}

function isTemporaryRedirectStatus(status: number): boolean {
  return status === 302 || status === 307
}

const LOCALE_SEG =
  /^(af|am|ar|az|be|bg|bn|bs|ca|cs|cy|da|de|el|en|es|et|eu|fa|fi|fr|gl|gu|he|hi|hr|hu|hy|id|is|it|ja|ka|kk|km|kn|ko|ky|lo|lt|lv|mk|ml|mn|mr|ms|my|ne|nl|no|pa|pl|pt|ro|ru|si|sk|sl|sq|sr|sv|sw|ta|te|th|tr|uk|ur|uz|vi|zh)(-[a-z]{2})?$/i

/**
 * Locale / geo-style redirect: path gains, loses, or swaps a leading locale
 * segment (e.g. `/products` → `/en/products`, `/en/x` → `/fr/x`).
 */
export function looksLikeLocaleRedirect(
  fromUrl: string,
  toUrl: string,
): boolean {
  let from: URL
  let to: URL
  try {
    from = new URL(fromUrl)
    to = new URL(toUrl)
  } catch {
    return false
  }
  if (from.host !== to.host) return false

  const a = from.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  const b = to.pathname.replace(/\/+$/, '').split('/').filter(Boolean)

  if (a.length === b.length && a[0] && b[0] && a[0] !== b[0]) {
    if (LOCALE_SEG.test(a[0]) && LOCALE_SEG.test(b[0])) {
      return a.slice(1).join('/') === b.slice(1).join('/')
    }
  }
  if (b.length === a.length + 1 && b[0] && LOCALE_SEG.test(b[0])) {
    return a.join('/') === b.slice(1).join('/')
  }
  if (a.length === b.length + 1 && a[0] && LOCALE_SEG.test(a[0])) {
    return a.slice(1).join('/') === b.join('/')
  }
  return false
}

export type ClassifyRedirectInput = {
  sourcePageUrl: string
  /** Original href attribute value (may include ?query#fragment). */
  href: string
  chain: HopRecordingResult
  /** Shared-nav vs page declaration. */
  declarationKind: 'shared-nav' | 'page' | 'unknown'
  /** Whether the first-hop 3xx was confirmed stable via topic 68. */
  redirectStable: boolean
}

export type ClassifyRedirectResult = {
  verdict: Topic42Verdict
  severity: RedirectSeverity | null
  hopCount: number
  /** Final destination URL from the chain (no fragment). */
  finalUrl: string | null
  /** Href to write — preserves query/fragment from the original. */
  rewriteHref: string | null
  detail: string
  conditions: {
    destinationInternal: boolean
    stable301or308: boolean
    finalHealthyIndexableCanonical: boolean
    noLoopNoAmbiguity: boolean
    queryFragmentPreserved: boolean
  }
}

export function classifyRedirectLink(
  input: ClassifyRedirectInput,
): ClassifyRedirectResult {
  const hopCount = redirectHopCount(input.chain)
  const severity = hopCount > 0 ? severityForHopCount(hopCount) : null

  const emptyConditions = {
    destinationInternal: false,
    stable301or308: false,
    finalHealthyIndexableCanonical: false,
    noLoopNoAmbiguity: false,
    queryFragmentPreserved: false,
  }

  if (hopCount === 0) {
    return {
      verdict: 'skip-not-redirect',
      severity: null,
      hopCount: 0,
      finalUrl: null,
      rewriteHref: null,
      detail: 'Target is not a redirect',
      conditions: emptyConditions,
    }
  }

  if (input.chain.stoppedReason === 'repeat-url') {
    return {
      verdict: 'route-topic-5-loop',
      severity,
      hopCount,
      finalUrl: null,
      rewriteHref: null,
      detail: 'Redirect loop — topic 5',
      conditions: emptyConditions,
    }
  }

  if (input.chain.stoppedReason === 'max-hops' || hopCount > 10) {
    return {
      verdict: 'route-topic-4-long-chain',
      severity: 'high',
      hopCount,
      finalUrl: null,
      rewriteHref: null,
      detail: `Redirect chain exceeds Googlebot hop limit (${hopCount}) — topic 4`,
      conditions: emptyConditions,
    }
  }

  if (input.chain.finalStatus < 200 || input.chain.finalStatus >= 300) {
    return {
      verdict: 'route-topic-1-non-200',
      severity,
      hopCount,
      finalUrl: normalizeFixStrategyUrl(input.chain.finalUrl) ?? input.chain.finalUrl,
      rewriteHref: null,
      detail: `Chain resolves to ${input.chain.finalStatus} — topic 1 or 7`,
      conditions: emptyConditions,
    }
  }

  // Final is 2xx
  const redirectHops = input.chain.hops.filter(
    (h) => h.status >= 300 && h.status < 400,
  )
  const allStable = redirectHops.every((h) => isStableRedirectStatus(h.status))
  const anyTemporary = redirectHops.some((h) =>
    isTemporaryRedirectStatus(h.status),
  )

  const finalNormalized =
    normalizeFixStrategyUrl(input.chain.finalUrl) ?? input.chain.finalUrl

  let destinationInternal = false
  try {
    const page = new URL(input.sourcePageUrl)
    const dest = new URL(finalNormalized)
    destinationInternal = dest.host === page.host
  } catch {
    destinationInternal = false
  }

  if (!destinationInternal) {
    return {
      verdict: 'skip-external-destination',
      severity,
      hopCount,
      finalUrl: finalNormalized,
      rewriteHref: null,
      detail: 'Final destination is external — out of scope',
      conditions: { ...emptyConditions, destinationInternal: false },
    }
  }

  const contentType = input.chain.finalHeaders.get('content-type')
  const noindex = hasNoindexDirective(
    input.chain.finalHeaders,
    input.chain.finalBody,
    contentType,
  )
  const canonical = extractHtmlCanonical(
    input.chain.finalBody,
    finalNormalized,
    contentType,
  )
  const selfCanonical = isSelfCanonical(finalNormalized, canonical)
  const finalHealthyIndexableCanonical =
    input.chain.finalStatus >= 200 &&
    input.chain.finalStatus < 300 &&
    !noindex &&
    selfCanonical

  const noLoopNoAmbiguity =
    input.chain.stoppedReason === 'non-3xx' &&
    hopCount >= 1 &&
    hopCount <= 10 &&
    input.redirectStable

  // Locale / conditional heuristic on first hop
  const first = redirectHops[0]!
  const localeConditional =
    first.location != null &&
    looksLikeLocaleRedirect(first.url, first.location)

  const rewriteHref = preserveQueryAndFragment(
    input.href,
    finalNormalized,
    input.sourcePageUrl,
  )

  const queryFragmentPreserved =
    rewriteHref != null &&
    !wouldDropQueryOrFragment(input.href, rewriteHref, input.sourcePageUrl)

  const conditions = {
    destinationInternal,
    stable301or308: allStable && !anyTemporary,
    finalHealthyIndexableCanonical,
    noLoopNoAmbiguity,
    queryFragmentPreserved,
  }

  if (anyTemporary || !allStable) {
    return {
      verdict: 'human-review-temporary-redirect',
      severity,
      hopCount,
      finalUrl: finalNormalized,
      rewriteHref,
      detail: 'Temporary 302/307 in chain — rewriting removes retarget ability',
      conditions,
    }
  }

  if (localeConditional) {
    return {
      verdict: 'human-review-conditional-redirect',
      severity,
      hopCount,
      finalUrl: finalNormalized,
      rewriteHref,
      detail: 'Locale/conditional redirect — rewriting changes behaviour',
      conditions,
    }
  }

  if (!input.redirectStable) {
    return {
      verdict: 'human-review-unstable',
      severity,
      hopCount,
      finalUrl: finalNormalized,
      rewriteHref,
      detail: 'Redirect not stable across topic-68 re-fetch',
      conditions,
    }
  }

  if (!finalHealthyIndexableCanonical) {
    return {
      verdict: 'human-review-not-canonical',
      severity,
      hopCount,
      finalUrl: finalNormalized,
      rewriteHref,
      detail: noindex
        ? 'Final target carries noindex'
        : 'Final target is not self-canonical — fix canonical first (topics 13–18)',
      conditions,
    }
  }

  if (!queryFragmentPreserved || rewriteHref == null) {
    return {
      verdict: 'human-review-would-drop-query-or-fragment',
      severity,
      hopCount,
      finalUrl: finalNormalized,
      rewriteHref,
      detail: 'Rewrite would drop query parameters or fragment (condition 5)',
      conditions,
    }
  }

  if (input.declarationKind === 'shared-nav') {
    return {
      verdict: 'human-review-shared-nav',
      severity,
      hopCount,
      finalUrl: finalNormalized,
      rewriteHref,
      detail: 'Link is in shared navigation — one finding naming the component',
      conditions,
    }
  }

  const allFive =
    conditions.destinationInternal &&
    conditions.stable301or308 &&
    conditions.finalHealthyIndexableCanonical &&
    conditions.noLoopNoAmbiguity &&
    conditions.queryFragmentPreserved

  if (allFive) {
    return {
      verdict: 'auto-rewrite',
      severity,
      hopCount,
      finalUrl: finalNormalized,
      rewriteHref,
      detail: `Stable ${hopCount}-hop redirect → ${rewriteHref}`,
      conditions,
    }
  }

  return {
    verdict: 'human-review-unstable',
    severity,
    hopCount,
    finalUrl: finalNormalized,
    rewriteHref,
    detail: 'Not all five auto-rewrite conditions hold',
    conditions,
  }
}

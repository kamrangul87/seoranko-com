/**
 * Classify duplicate-URL findings (topics 8–12) after variant fetch + sameness.
 */

import type { DuplicateUrlStrategy } from '@/lib/fix-strategies/shared/duplicate-url-variants'
import type { PreferredFormResult } from '@/lib/fix-strategies/shared/preferred-form'

export type DuplicateUrlVerdict =
  | 'ok-already-normalises'
  | 'suppress-different-content'
  | 'suppress-site-root'
  | 'suppress-not-applicable'
  | 'finding-duplicate'
  | 'auto-redirect'
  | 'auto-canonical-annotation'
  | 'human-review-preferred-conflict'
  | 'human-review-preferred-absent'
  | 'human-review-https-exception'
  | 'human-review-blast-radius'
  | 'human-review-outside-repo'
  | 'report-only-12b'
  | 'suppress-tracking-content-differs'
  | 'suppress-auth-token-param'
  | 'indeterminate-middleware'

export type ClassifyDuplicateInput = {
  strategy: DuplicateUrlStrategy
  /** Variant returned 3xx to the other form. */
  alreadyRedirects: boolean
  contentSame: boolean
  /** Topic 8 site root. */
  isSiteRoot: boolean
  preferred: PreferredFormResult
  /** Topic 9 HTTPS exceptions. */
  httpsExceptions?: {
    invalidTls?: boolean
    mixedContent?: boolean
    httpsRedirectsToHttp?: boolean
    httpsCanonicalPointsHttp?: boolean
  }
  /** Topic 11: proposing a blanket lowercase rule (rejected). */
  blanketLowercaseProposed?: boolean
  /** Topic 12: all params on tracking allow-list. */
  allParamsTracking?: boolean
  /** Topic 12: auth/token/signed param present. */
  hasAuthOrSignedParam?: boolean
  /** Topic 10: redirect cannot be expressed in repo. */
  fixOutsideRepo?: boolean
  /** Middleware-produced variant, scope unresolved. */
  middlewareIndeterminate?: boolean
}

export type ClassifyDuplicateResult = {
  verdict: DuplicateUrlVerdict
  detail: string
  /** Prefer canonical annotation over redirect for tracking params. */
  preferCanonicalOverRedirect: boolean
}

export function classifyDuplicateUrl(
  input: ClassifyDuplicateInput,
): ClassifyDuplicateResult {
  if (input.isSiteRoot && input.strategy === 'trailing-slash') {
    return {
      verdict: 'suppress-site-root',
      detail: 'Site root slash forms are equivalent — never raise (topic 8)',
      preferCanonicalOverRedirect: false,
    }
  }

  if (input.alreadyRedirects) {
    return {
      verdict: 'ok-already-normalises',
      detail: 'One form already redirects to the other — site normalises',
      preferCanonicalOverRedirect: false,
    }
  }

  if (input.middlewareIndeterminate) {
    return {
      verdict: 'indeterminate-middleware',
      detail: 'Variant produced by middleware — scope indeterminate (topic 70)',
      preferCanonicalOverRedirect: false,
    }
  }

  if (!input.contentSame) {
    if (input.strategy === 'path-case') {
      return {
        verdict: 'suppress-different-content',
        detail:
          'Case variants serve different content — case-sensitive server; never raise, never redirect',
        preferCanonicalOverRedirect: false,
      }
    }
    if (input.strategy === 'query-params' && input.allParamsTracking) {
      return {
        verdict: 'suppress-tracking-content-differs',
        detail:
          'Tracking param name on allow-list but content differs — name is not evidence',
        preferCanonicalOverRedirect: false,
      }
    }
    return {
      verdict: 'suppress-different-content',
      detail: 'Content differs — not a duplicate',
      preferCanonicalOverRedirect: false,
    }
  }

  // Content proven same from here.

  if (input.strategy === 'path-case' && input.blanketLowercaseProposed) {
    return {
      verdict: 'human-review-blast-radius',
      detail:
        'REJECTED: blanket lowercase rule — only a specific proven pair may be fixed',
      preferCanonicalOverRedirect: false,
    }
  }

  if (input.strategy === 'query-params') {
    if (input.hasAuthOrSignedParam) {
      return {
        verdict: 'suppress-auth-token-param',
        detail: 'Auth/token/signed parameter — never redirect or canonicalize',
        preferCanonicalOverRedirect: false,
      }
    }
    if (!input.allParamsTracking) {
      return {
        verdict: 'report-only-12b',
        detail:
          'Non-tracking / unknown parameters — 12b report-only; not mechanically fixable',
        preferCanonicalOverRedirect: true,
      }
    }
    // 12a — prefer canonical over redirect (campaign links).
    return {
      verdict: 'auto-canonical-annotation',
      detail:
        '12a tracking params + identical content — prefer canonical annotation over redirect (campaign links)',
      preferCanonicalOverRedirect: true,
    }
  }

  if (input.strategy === 'http-https') {
    const ex = input.httpsExceptions ?? {}
    if (ex.invalidTls) {
      return {
        verdict: 'human-review-https-exception',
        detail: 'HTTPS has invalid/expired TLS — never redirect to it',
        preferCanonicalOverRedirect: false,
      }
    }
    if (ex.mixedContent) {
      return {
        verdict: 'human-review-https-exception',
        detail: 'HTTPS page has insecure dependencies — human-review',
        preferCanonicalOverRedirect: false,
      }
    }
    if (ex.httpsRedirectsToHttp) {
      return {
        verdict: 'human-review-https-exception',
        detail: 'HTTPS redirects to HTTP — contradictory config',
        preferCanonicalOverRedirect: false,
      }
    }
    if (ex.httpsCanonicalPointsHttp) {
      return {
        verdict: 'human-review-https-exception',
        detail: 'HTTPS canonical points at HTTP — fix canonical with redirect',
        preferCanonicalOverRedirect: false,
      }
    }
    // Documented preference → auto-redirect when healthy
    return {
      verdict: 'auto-redirect',
      detail: 'HTTP/HTTPS duplicate — Google prefers HTTPS; permanent redirect',
      preferCanonicalOverRedirect: false,
    }
  }

  if (input.fixOutsideRepo) {
    return {
      verdict: 'human-review-outside-repo',
      detail: 'Redirect cannot be expressed in the repo — report-only',
      preferCanonicalOverRedirect: false,
    }
  }

  if (input.preferred.status === 'conflict') {
    return {
      verdict: 'human-review-preferred-conflict',
      detail: input.preferred.detail,
      preferCanonicalOverRedirect: false,
    }
  }

  if (input.preferred.status === 'absent') {
    return {
      verdict: 'human-review-preferred-absent',
      detail: input.preferred.detail,
      preferCanonicalOverRedirect: false,
    }
  }

  // Signals agree
  if (input.strategy === 'trailing-slash') {
    return {
      verdict: 'auto-redirect',
      detail: `Trailing-slash duplicate — signals agree (${input.preferred.source}); prefer redirect via trailingSlash`,
      preferCanonicalOverRedirect: false,
    }
  }

  if (input.strategy === 'index-html') {
    return {
      verdict: 'auto-redirect',
      detail: `Directory index.html duplicate — signals agree (${input.preferred.source}); prefer clean directory URL`,
      preferCanonicalOverRedirect: false,
    }
  }

  if (input.strategy === 'www-non-www') {
    // Dossier: human-review by default (often outside repo); with resolved
    // preference still human-review for host choice convention.
    return {
      verdict: 'human-review-blast-radius',
      detail: `www/non-www duplicate — preferred ${input.preferred.preferred} from ${input.preferred.source}; host fix often outside repo`,
      preferCanonicalOverRedirect: false,
    }
  }

  if (input.strategy === 'path-case') {
    return {
      verdict: 'auto-redirect',
      detail:
        'Specific proven case pair with identical content — redirect non-preferred casing only (never blanket)',
      preferCanonicalOverRedirect: false,
    }
  }

  return {
    verdict: 'finding-duplicate',
    detail: 'Duplicate URL forms with proven identical content',
    preferCanonicalOverRedirect: false,
  }
}

/** Topic 12a: is every param name on the tracking allow-list? */
export function allParamsAreTracking(
  paramNames: string[],
  allowlist: readonly string[],
): boolean {
  if (paramNames.length === 0) return false
  const set = new Set(allowlist.map((n) => n.toLowerCase()))
  return paramNames.every((n) => {
    const lower = n.toLowerCase()
    if (set.has(lower)) return true
    // utm_* prefix
    if (lower.startsWith('utm_') && set.has('utm_source')) return true
    return false
  })
}

const AUTH_PARAM_RE =
  /^(token|auth|signature|sig|jwt|access_token|refresh_token|api_key|key)$/i

export function hasAuthOrSignedParam(paramNames: string[]): boolean {
  return paramNames.some((n) => AUTH_PARAM_RE.test(n))
}

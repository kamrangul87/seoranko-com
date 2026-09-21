/**
 * Preferred-form derivation for duplicate-URL topics 8, 10, 11.
 *
 * Topic 9 is the ONLY topic with a documented preferred form (HTTPS).
 * Topics 8/10/11 derive from site signals — no defaults when signals conflict.
 *
 * Signal order (dossier topic 8):
 * 1. existing rel=canonical on either variant
 * 2. form present in the sitemap
 * 3. form used by the majority of internal links
 * 4. next.config trailingSlash (topic 8 only)
 */

import { normalizeFixStrategyUrl } from './url-normalize'
import type { DuplicateUrlStrategy } from './duplicate-url-variants'

export type PreferredFormSignals = {
  /** Canonical hrefs observed on either variant (absolute). */
  canonicals?: string[]
  /** URLs listed in the sitemap. */
  sitemapUrls?: string[]
  /** Internal link hrefs (absolute or resolvable). */
  internalLinkUrls?: string[]
  /**
   * next.config `trailingSlash` boolean when known (topic 8 only).
   * true → prefer slash form; false → prefer non-slash.
   */
  trailingSlashConfig?: boolean | null
  /** Existing host redirect target when known (topic 10). */
  existingRedirectTarget?: string | null
}

export type PreferredFormResult =
  | {
      status: 'resolved'
      preferred: string
      nonPreferred: string
      source: string
    }
  | {
      status: 'conflict'
      candidates: string[]
      detail: string
    }
  | {
      status: 'absent'
      detail: string
    }

function pickMatching(
  urls: string[],
  a: string,
  b: string,
): string | null {
  const na = normalizeFixStrategyUrl(a)
  const nb = normalizeFixStrategyUrl(b)
  const hits = new Set<string>()
  for (const u of urls) {
    const n = normalizeFixStrategyUrl(u)
    if (!n) continue
    if (n === na) hits.add(a)
    if (n === nb) hits.add(b)
  }
  if (hits.size === 1) return Array.from(hits)[0]!
  return null
}

function majorityOf(urls: string[], a: string, b: string): string | null {
  const na = normalizeFixStrategyUrl(a)
  const nb = normalizeFixStrategyUrl(b)
  let countA = 0
  let countB = 0
  for (const u of urls) {
    const n = normalizeFixStrategyUrl(u)
    if (n === na) countA++
    if (n === nb) countB++
  }
  if (countA === 0 && countB === 0) return null
  if (countA === countB) return null
  return countA > countB ? a : b
}

/**
 * Derive preferred form between `a` and `b` from site signals.
 * Never guesses — conflict or absent → human-review.
 */
export function derivePreferredForm(
  a: string,
  b: string,
  strategy: DuplicateUrlStrategy,
  signals: PreferredFormSignals = {},
): PreferredFormResult {
  // Topic 9 — HTTPS is documented preferred (caller should use httpsPreferred).
  if (strategy === 'http-https') {
    return httpsPreferred(a, b)
  }

  // Topic 12 — clean URL is preferred when tracking params proven.
  if (strategy === 'query-params') {
    try {
      const ua = new URL(a)
      const ub = new URL(b)
      const clean = !ua.search ? a : !ub.search ? b : null
      const dirty = clean === a ? b : clean === b ? a : null
      if (clean && dirty) {
        return {
          status: 'resolved',
          preferred: clean,
          nonPreferred: dirty,
          source: 'clean-url-no-query',
        }
      }
    } catch {
      // fall through
    }
  }

  const sources: Array<{ name: string; pick: string | null }> = []

  if (signals.canonicals && signals.canonicals.length > 0) {
    sources.push({
      name: 'canonical',
      pick: pickMatching(signals.canonicals, a, b),
    })
  }
  if (signals.sitemapUrls && signals.sitemapUrls.length > 0) {
    sources.push({
      name: 'sitemap',
      pick: pickMatching(signals.sitemapUrls, a, b),
    })
  }
  if (signals.internalLinkUrls && signals.internalLinkUrls.length > 0) {
    sources.push({
      name: 'internal-links-majority',
      pick: majorityOf(signals.internalLinkUrls, a, b),
    })
  }

  if (strategy === 'trailing-slash' && signals.trailingSlashConfig != null) {
    try {
      const ua = new URL(a)
      const slashForm = ua.pathname.endsWith('/') ? a : b
      const nonSlashForm = slashForm === a ? b : a
      sources.push({
        name: 'next.config.trailingSlash',
        pick: signals.trailingSlashConfig ? slashForm : nonSlashForm,
      })
    } catch {
      // skip
    }
  }

  // Prefer the non-index.html directory form when one side is .../index.html
  // (sitemap / clean URLs almost always list /blog not /blog/index.html).
  if (strategy === 'index-html') {
    try {
      const pickNonIndex = (u: string) =>
        /\/index\.html?$/i.test(new URL(u).pathname) ? null : u
      const preferred = pickNonIndex(a) ?? pickNonIndex(b)
      if (preferred) {
        sources.push({ name: 'directory-index-clean', pick: preferred })
      }
    } catch {
      // skip
    }
  }

  if (strategy === 'www-non-www' && signals.existingRedirectTarget) {
    const t = normalizeFixStrategyUrl(signals.existingRedirectTarget)
    const na = normalizeFixStrategyUrl(a)
    const nb = normalizeFixStrategyUrl(b)
    sources.push({
      name: 'existing-redirect',
      pick: t === na ? a : t === nb ? b : null,
    })
  }

  const resolved = sources.filter((s) => s.pick != null) as Array<{
    name: string
    pick: string
  }>

  if (resolved.length === 0) {
    return {
      status: 'absent',
      detail:
        'No site signals for preferred form — human-review; no default (Google has no preference)',
    }
  }

  const first = resolved[0]!.pick
  const conflict = resolved.filter((s) => {
    const n = normalizeFixStrategyUrl(s.pick)
    return n !== normalizeFixStrategyUrl(first)
  })

  if (conflict.length > 0) {
    return {
      status: 'conflict',
      candidates: Array.from(
        new Set(resolved.map((s) => normalizeFixStrategyUrl(s.pick)!).filter(Boolean)),
      ),
      detail: `Site signals conflict: ${resolved.map((s) => `${s.name}=${s.pick}`).join('; ')}`,
    }
  }

  const preferred = first
  const nonPreferred = normalizeFixStrategyUrl(preferred) === normalizeFixStrategyUrl(a) ? b : a
  return {
    status: 'resolved',
    preferred,
    nonPreferred,
    source: resolved.map((s) => s.name).join('+'),
  }
}

/**
 * Topic 9 only — Google prefers HTTPS. Returns conflict if neither is HTTPS.
 */
export function httpsPreferred(a: string, b: string): PreferredFormResult {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    if (ua.protocol === 'https:' && ub.protocol === 'http:') {
      return {
        status: 'resolved',
        preferred: a,
        nonPreferred: b,
        source: 'google-prefers-https',
      }
    }
    if (ub.protocol === 'https:' && ua.protocol === 'http:') {
      return {
        status: 'resolved',
        preferred: b,
        nonPreferred: a,
        source: 'google-prefers-https',
      }
    }
    return {
      status: 'absent',
      detail: 'Neither form is a clear HTTP→HTTPS pair',
    }
  } catch {
    return { status: 'absent', detail: 'Unparseable URLs for HTTPS preference' }
  }
}

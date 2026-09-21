/**
 * ONE variant generator for duplicate-URL topics 8–12.
 *
 * Five strategies — not five detectors. Topic 8 is the template; 9–12 only
 * differ in which strategy generates the opposite form.
 *
 * Uses `normalizeFixStrategyUrl` for comparison identity. That helper MUST
 * NOT collapse trailing slash, path case, query, or port — those differences
 * ARE these findings.
 */

import { normalizeFixStrategyUrl } from './url-normalize'

export type DuplicateUrlStrategy =
  | 'trailing-slash' // topic 8
  | 'index-html' // topic 8 — /x vs /x/index.html (not covered by trailing-slash)
  | 'http-https' // topic 9
  | 'www-non-www' // topic 10
  | 'path-case' // topic 11
  | 'query-params' // topic 12

export type VariantPair = {
  strategy: DuplicateUrlStrategy
  /** The crawled / seed URL (normalised for scheme/host only). */
  a: string
  /** The generated opposite form. */
  b: string
  /**
   * For topic 12: the clean path (no query) when `a` had params.
   * Null for other strategies.
   */
  cleanUrl: string | null
  /** Topic 12 parameter names present on the parameterised form. */
  paramNames: string[]
  detail: string
}

/**
 * Generate the opposite URL form for a strategy.
 * Returns null when the strategy cannot produce a distinct variant
 * (e.g. site root for trailing-slash, already-lowercase path for path-case
 * without an uppercase counterpart hint).
 */
export function generateVariant(
  url: string,
  strategy: DuplicateUrlStrategy,
  opts?: {
    /**
     * Topic 11: optional uppercase variant observed in site links when the
     * crawled URL is all-lowercase.
     */
    uppercaseHint?: string | null
  },
): VariantPair | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  switch (strategy) {
    case 'trailing-slash':
      return trailingSlashVariant(parsed)
    case 'index-html':
      return indexHtmlVariant(parsed)
    case 'http-https':
      return httpHttpsVariant(parsed)
    case 'www-non-www':
      return wwwVariant(parsed)
    case 'path-case':
      return pathCaseVariant(parsed, opts?.uppercaseHint ?? null)
    case 'query-params':
      return queryParamsVariant(parsed)
    default:
      return null
  }
}

function asPair(
  strategy: DuplicateUrlStrategy,
  a: URL,
  b: URL,
  detail: string,
  extra?: { cleanUrl?: string | null; paramNames?: string[] },
): VariantPair | null {
  const na = normalizeFixStrategyUrl(a.href)
  const nb = normalizeFixStrategyUrl(b.href)
  if (!na || !nb || na === nb) return null
  return {
    strategy,
    a: na,
    b: nb,
    cleanUrl: extra?.cleanUrl ?? null,
    paramNames: extra?.paramNames ?? [],
    detail,
  }
}

function trailingSlashVariant(parsed: URL): VariantPair | null {
  // Site root EXCLUDED — example.com and example.com/ are equivalent.
  const path = parsed.pathname || '/'
  if (path === '/' || path === '') {
    return null
  }
  // /x/index.html slash flip is not the directory-index case — leave to index-html.
  if (/\/index\.html?$/i.test(path)) {
    return null
  }

  const opposite = new URL(parsed.href)
  if (path.endsWith('/')) {
    opposite.pathname = path.replace(/\/+$/, '') || '/'
  } else {
    opposite.pathname = `${path}/`
  }
  return asPair(
    'trailing-slash',
    parsed,
    opposite,
    'Trailing-slash opposite form',
  )
}

/**
 * /blog ↔ /blog/index.html (and / ↔ /index.html).
 * Trailing-slash alone never produces this pair.
 */
function indexHtmlVariant(parsed: URL): VariantPair | null {
  const path = parsed.pathname || '/'
  const opposite = new URL(parsed.href)
  const indexMatch = path.match(/^(.*)\/index\.html?$/i)
  if (indexMatch) {
    const dir = indexMatch[1] ?? ''
    opposite.pathname = dir === '' ? '/' : dir
  } else if (path === '/' || path === '') {
    opposite.pathname = '/index.html'
  } else if (path.endsWith('/')) {
    opposite.pathname = `${path}index.html`
  } else {
    opposite.pathname = `${path}/index.html`
  }
  return asPair(
    'index-html',
    parsed,
    opposite,
    'Directory index.html opposite form',
  )
}

function httpHttpsVariant(parsed: URL): VariantPair | null {
  const opposite = new URL(parsed.href)
  if (parsed.protocol === 'https:') {
    opposite.protocol = 'http:'
  } else {
    opposite.protocol = 'https:'
  }
  return asPair('http-https', parsed, opposite, 'HTTP/HTTPS opposite form')
}

function wwwVariant(parsed: URL): VariantPair | null {
  const host = parsed.hostname
  const opposite = new URL(parsed.href)
  if (host.startsWith('www.')) {
    opposite.hostname = host.slice(4)
  } else {
    opposite.hostname = `www.${host}`
  }
  return asPair('www-non-www', parsed, opposite, 'www / non-www opposite host')
}

function pathCaseVariant(
  parsed: URL,
  uppercaseHint: string | null,
): VariantPair | null {
  const path = parsed.pathname || '/'
  const hasUpper = /[A-Z]/.test(path)

  if (hasUpper) {
    // Fetch the lowercased path form (path only — never touch host).
    const opposite = new URL(parsed.href)
    opposite.pathname = path.toLowerCase()
    // NEVER lowercase query strings (guard 4).
    return asPair(
      'path-case',
      parsed,
      opposite,
      'Lowercased path variant of crawled uppercase path',
    )
  }

  // All-lowercase crawled URL: only test when site links provide an uppercase hint.
  if (uppercaseHint) {
    try {
      const hint = new URL(uppercaseHint, parsed.href)
      if (hint.pathname.toLowerCase() !== path.toLowerCase()) return null
      if (hint.pathname === path) return null
      const opposite = new URL(parsed.href)
      opposite.pathname = hint.pathname
      return asPair(
        'path-case',
        parsed,
        opposite,
        'Uppercase path variant observed in site links',
      )
    } catch {
      return null
    }
  }

  return null
}

function queryParamsVariant(parsed: URL): VariantPair | null {
  if (!parsed.search || parsed.search === '?') return null

  const params = new URLSearchParams(parsed.search)
  const names = Array.from(new Set(Array.from(params.keys())))
  if (names.length === 0) return null

  const clean = new URL(parsed.href)
  clean.search = ''
  const cleanNorm = normalizeFixStrategyUrl(clean.href)
  if (!cleanNorm) return null

  return asPair(
    'query-params',
    parsed,
    clean,
    'Parameterised URL vs clean path',
    { cleanUrl: cleanNorm, paramNames: names },
  )
}

/**
 * True when the URL is the site root path (`/` only) — excluded from topic 8.
 */
export function isSiteRootUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const path = u.pathname || '/'
    return path === '/' || path === ''
  } catch {
    return false
  }
}

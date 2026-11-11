/**
 * Utility / legal / account pages that belong in nav and footer only.
 * They are never Related reading sources or targets, and never content orphans.
 */

import { decodeHtmlEntities } from '@/lib/fix-strategies/related-articles/anchors'

export type UtilityPageInput = {
  url?: string | null
  href?: string | null
  title?: string | null
  h1?: string | null
}

const UTILITY_SLUGS = new Set([
  'privacy',
  'privacy-policy',
  'privacy-notice',
  'cookie',
  'cookies',
  'cookie-policy',
  'cookies-policy',
  'cookie-notice',
  'terms',
  'terms-of-service',
  'terms-of-use',
  'terms-and-conditions',
  'tos',
  'legal',
  'legal-notice',
  'legal-information',
  'disclaimer',
  'contact',
  'contact-us',
  'contact-me',
  'about',
  'about-us',
  'about-me',
  'accessibility',
  'accessibility-statement',
  'sitemap',
  'site-map',
  'login',
  'log-in',
  'signin',
  'sign-in',
  'signup',
  'sign-up',
  'register',
  'account',
  'my-account',
  'myaccount',
  'cart',
  'basket',
  'checkout',
  'wishlist',
  '404',
  'not-found',
  'page-not-found',
  'search',
  'search-results',
])

const ARCHIVE_SEGMENTS = new Set([
  'tag',
  'tags',
  'category',
  'categories',
  'author',
  'authors',
])

const TITLE_EXACT =
  /^(privacy policy|cookie policy|cookies? policy|terms(?: of (?:service|use)| and conditions)?|legal(?: notice)?|disclaimer|contact(?: us)?|about(?: us)?|accessibility(?: statement)?|sitemap|site map|log ?in|sign ?in|sign ?up|create account|my account|shopping cart|checkout|page not found|404|search(?: results)?)$/i

const ARTICLE_LIKE =
  /\b(how to|guide|explained|checklist|vs\.?|what to|why |when to)\b|\b20\d{2}\b/i

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function stripSiteSuffix(s: string): string {
  return collapseWs(s.split(/\s*[|—–•]\s*/)[0] || s)
}

function pathnameOf(urlOrHref: string): string {
  const raw = urlOrHref.trim()
  if (!raw) return ''
  try {
    if (/^https?:\/\//i.test(raw)) {
      return new URL(raw).pathname || '/'
    }
  } catch {
    /* keep */
  }
  const noQuery = raw.split(/[?#]/)[0] || raw
  if (!noQuery) return ''
  return noQuery.startsWith('/') ? noQuery : `/${noQuery}`
}

function pathSegments(pathname: string): string[] {
  return pathname
    .toLowerCase()
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => seg.replace(/\.(html?|php|aspx?)$/i, ''))
    .filter((seg) => seg && seg !== 'index')
}

function isUtilityTitle(raw: string | null | undefined): boolean {
  if (!raw) return false
  const decoded = collapseWs(decodeHtmlEntities(raw))
  if (!decoded) return false
  const stripped = stripSiteSuffix(decoded)
  if (TITLE_EXACT.test(stripped) || TITLE_EXACT.test(decoded)) return true

  if (/^contact(\s+us)?\b/i.test(stripped) && !ARTICLE_LIKE.test(stripped)) {
    return true
  }
  if (/^about(\s+us)?\b/i.test(stripped)) {
    const rest = stripped.replace(/^about(\s+us)?\s*/i, '').trim()
    if (!rest) return true
    const restWords = rest.split(/\s+/).filter(Boolean)
    if (restWords.length <= 3 && !ARTICLE_LIKE.test(rest)) return true
  }
  return false
}

function isUtilityPath(urlOrHref: string | null | undefined): boolean {
  if (!urlOrHref) return false
  const pathname = pathnameOf(urlOrHref)
  if (!pathname || pathname === '/') return false
  const segments = pathSegments(pathname)
  if (segments.length === 0) return false
  if (segments.some((s) => ARCHIVE_SEGMENTS.has(s))) return true
  const last = segments[segments.length - 1]!
  return UTILITY_SLUGS.has(last)
}

export function isUtilityPage(input: UtilityPageInput): boolean {
  if (isUtilityPath(input.url) || isUtilityPath(input.href)) return true
  if (isUtilityTitle(input.h1) || isUtilityTitle(input.title)) return true
  return false
}

export function isContentPage(input: UtilityPageInput): boolean {
  return !isUtilityPage(input)
}

/**
 * Structural pagination signals for topic 71 and cross-topic guards
 * (12 / 27 / 33 / 45). Structural URL/HTML only — no body-copy matching.
 */

import { parseHtml, type HtmlElement } from './html-parser'
import { normalizeFixStrategyUrl } from './url-normalize'

/**
 * Query param names treated as page-N pagination.
 * Deliberately excludes bare `p` (often a CMS post id, e.g. WordPress ?p=).
 */
export const PAGINATION_QUERY_PARAM_NAMES = [
  'page',
  'paged',
  'pagenum',
  'pg',
] as const

const PATH_PAGE_RE = /\/page\/(\d+)\/?$/i

export type PaginationSignal = {
  url: string
  urlNormalized: string
  /** 1-based page index when detectable; null if only “is paginated” is known. */
  pageNumber: number | null
  /** Path/query form without the page token (series key). */
  seriesKey: string | null
  /** How the page token was detected. */
  kind: 'query' | 'path'
}

export function isPaginationQueryParamName(name: string): boolean {
  const lower = name.toLowerCase()
  return (PAGINATION_QUERY_PARAM_NAMES as readonly string[]).includes(lower)
}

/** True when every query param on the URL is a pagination param (topic 12 guard). */
export function allParamsArePagination(paramNames: string[]): boolean {
  if (paramNames.length === 0) return false
  return paramNames.every((n) => isPaginationQueryParamName(n))
}

export function parsePaginationFromUrl(url: string): PaginationSignal | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const norm = normalizeFixStrategyUrl(url) || url
  const params = [...parsed.searchParams.keys()]
  const pageParam = params.find((k) => isPaginationQueryParamName(k))
  if (pageParam) {
    const raw = parsed.searchParams.get(pageParam)
    const n = raw != null ? Number.parseInt(raw, 10) : NaN
    const series = new URL(parsed.href)
    for (const name of PAGINATION_QUERY_PARAM_NAMES) {
      series.searchParams.delete(name)
    }
    const seriesKey =
      normalizeFixStrategyUrl(series.href) ||
      `${series.origin}${series.pathname}${series.search}`
    return {
      url,
      urlNormalized: norm,
      pageNumber: Number.isFinite(n) && n >= 1 ? n : null,
      seriesKey,
      kind: 'query',
    }
  }

  const pathMatch = parsed.pathname.match(PATH_PAGE_RE)
  if (pathMatch) {
    const n = Number.parseInt(pathMatch[1]!, 10)
    const basePath = parsed.pathname.replace(PATH_PAGE_RE, '/')
    const series = new URL(parsed.href)
    series.pathname = basePath.endsWith('/') ? basePath : `${basePath}/`
    const seriesKey = normalizeFixStrategyUrl(series.href) || series.href
    return {
      url,
      urlNormalized: norm,
      pageNumber: Number.isFinite(n) && n >= 1 ? n : null,
      seriesKey,
      kind: 'path',
    }
  }

  return null
}

export function isPaginatedUrl(url: string): boolean {
  return parsePaginationFromUrl(url) != null
}

function attr(el: HtmlElement, name: string): string {
  return el.attrs[name] ?? el.attrs[name.toLowerCase()] ?? ''
}

/**
 * Detect fragment-only “pagination” hrefs (#page-2, #/page/2) — Google ignores
 * fragments for distinct pages (P1).
 */
export function hasFragmentOnlyPaginationLinks(html: string): boolean {
  const parsed = parseHtml(html)
  for (const a of [...parsed.headElements('a'), ...parsed.bodyElements('a')]) {
    const href = attr(a, 'href').trim()
    if (!href.startsWith('#')) continue
    if (/page[=/_-]?\d+/i.test(href)) return true
  }
  return false
}

export type RelPaginationLinks = {
  nextHref: string | null
  prevHref: string | null
}

/** Collect link[rel=next|prev] — discovery aid only; never a Google requirement. */
export function extractRelPaginationLinks(
  html: string,
  pageUrl: string,
): RelPaginationLinks {
  const parsed = parseHtml(html)
  let nextHref: string | null = null
  let prevHref: string | null = null
  for (const link of parsed.headElements('link')) {
    const rel = attr(link, 'rel').toLowerCase().split(/\s+/)
    const href = attr(link, 'href')
    if (!href) continue
    let abs: string
    try {
      abs = new URL(href, pageUrl).href
    } catch {
      continue
    }
    if (rel.includes('next')) nextHref = abs
    if (rel.includes('prev') || rel.includes('previous')) prevHref = abs
  }
  return { nextHref, prevHref }
}

function resolveAbs(href: string, pageUrl: string): string | null {
  try {
    return new URL(href, pageUrl).href
  } catch {
    return null
  }
}

/** Crawlable <a href> targets that look like pagination page ≥2. */
export function crawlablePaginationHrefs(
  html: string,
  pageUrl: string,
): string[] {
  const parsed = parseHtml(html)
  const out: string[] = []
  for (const a of [...parsed.headElements('a'), ...parsed.bodyElements('a')]) {
    const href = attr(a, 'href').trim()
    if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) {
      continue
    }
    const abs = resolveAbs(href, pageUrl)
    if (!abs) continue
    const sig = parsePaginationFromUrl(abs)
    if (sig && sig.pageNumber != null && sig.pageNumber >= 2) {
      out.push(abs)
    }
  }
  return out
}

/**
 * Non-crawlable next: link[rel=next] or data-* pagination URL present, but no
 * crawlable <a href> to a page≥2 URL. Structural attributes only.
 */
export function hasNoncrawlableNextWithoutHref(
  html: string,
  pageUrl: string,
): boolean {
  if (crawlablePaginationHrefs(html, pageUrl).length > 0) return false

  const { nextHref } = extractRelPaginationLinks(html, pageUrl)
  if (nextHref && parsePaginationFromUrl(nextHref)) return true

  const parsed = parseHtml(html)
  const candidates = [
    ...parsed.bodyElements('button'),
    ...parsed.bodyElements('a'),
    ...parsed.bodyElements('div'),
    ...parsed.bodyElements('span'),
  ]
  for (const el of candidates) {
    const attrs = [
      attr(el, 'data-page'),
      attr(el, 'data-paged'),
      attr(el, 'data-url'),
      attr(el, 'data-href'),
      attr(el, 'onclick'),
      attr(el, 'href'),
    ]
      .filter(Boolean)
      .join(' ')
    if (/[?&]page(d|num)?=\d+/i.test(attrs) || /\/page\/\d+/i.test(attrs)) {
      return true
    }
  }
  return false
}

/** URLs that are page ≥2 in a detected series (for topic 45 metric labelling). */
export function paginationPatternUrlsFromCrawl(urls: string[]): string[] {
  const out: string[] = []
  for (const u of urls) {
    const sig = parsePaginationFromUrl(u)
    if (sig && sig.pageNumber != null && sig.pageNumber >= 2) {
      out.push(sig.urlNormalized)
    }
  }
  return out
}

/**
 * True when two normalized URLs are the same series and `canonical` is page 1
 * while `pageUrl` is page ≥2.
 */
export function isCanonicalToSeriesPageOne(
  pageUrl: string,
  canonicalUrl: string,
): boolean {
  const page = parsePaginationFromUrl(pageUrl)
  if (!page || page.pageNumber == null || page.pageNumber < 2) return false
  if (!page.seriesKey) return false

  const canon = parsePaginationFromUrl(canonicalUrl)
  const canonNorm = normalizeFixStrategyUrl(canonicalUrl) || canonicalUrl
  const seriesFirst = page.seriesKey

  if (
    canonNorm === seriesFirst ||
    canonNorm.replace(/\/$/, '') === seriesFirst.replace(/\/$/, '')
  ) {
    return true
  }
  if (canon && canon.seriesKey === page.seriesKey && canon.pageNumber === 1) {
    return true
  }
  return false
}

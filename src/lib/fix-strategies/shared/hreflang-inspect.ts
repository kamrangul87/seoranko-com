/**
 * ONE hreflang annotation collector for topics 46 / 47 / 48.
 *
 * Reads all THREE declaration methods Google supports equally (G1):
 *   1. HTML <link rel="alternate" hreflang="…">
 *   2. HTTP Link: <…>; rel="alternate"; hreflang="…"
 *   3. XML sitemap xhtml:link (via SitemapInspection / parseSitemapXml)
 *
 * Failing to check all three is the principal false-positive source.
 */

import { parseHtml } from './html-parser'
import { normalizeFixStrategyUrl } from './url-normalize'
import { splitLinkHeader } from './canonical-extraction'
import {
  extractHtmlCanonical,
  hasNoindexDirective,
} from './response-signals'
import {
  isPathAllowedFromInspection,
  type RobotsTxtInspection,
} from './robots-txt-inspect'
import {
  extractSitemapHreflangLinks,
  type SitemapHreflangLink,
} from './sitemap-xml'
import type { SitemapInspection } from './sitemap-inspect'

export type HreflangMethod = 'html' | 'http-link' | 'sitemap'

export type HreflangAnnotation = {
  hreflangRaw: string
  hrefRaw: string
  hrefNormalized: string | null
  method: HreflangMethod
  /** Page that declares this annotation. */
  sourceUrl: string
  sourceUrlNormalized: string
  /** HTML: whether the link sits in <head>. null for non-HTML methods. */
  inHead: boolean | null
  /** G23 — hreflang combined with media. */
  hasMedia: boolean
  /** Sitemap: the <loc> of the url block containing this link. */
  sitemapLoc: string | null
}

export type PageHreflangRecord = {
  url: string
  urlNormalized: string
  annotations: HreflangAnnotation[]
  htmlAnnotations: HreflangAnnotation[]
  headerAnnotations: HreflangAnnotation[]
  sitemapAnnotations: HreflangAnnotation[]
  /** HTML alternates the parser placed in <body> (G24 → topic 29). */
  bodyHtmlAnnotations: HreflangAnnotation[]
  /** Union usable for reciprocity (head HTML + header + sitemap). */
  effectiveAnnotations: HreflangAnnotation[]
  status: number | null
  redirectHopCount: number
  finalUrlNormalized: string | null
  hasNoindex: boolean
  repoDeclaredNoindex: boolean
  robotsDisallowedGooglebot: boolean
  canonicalNormalized: string | null
}

export type HreflangInspection = {
  originUrl: string
  pages: PageHreflangRecord[]
  pageByNormalizedUrl: Map<string, PageHreflangRecord>
}

export type HreflangPageInput = {
  url: string
  html?: string
  headers?: Headers
  contentType?: string | null
  status?: number | null
  /** Number of redirect hops before the final response (0 = none). */
  redirectHopCount?: number
  finalUrl?: string | null
  repoDeclaredNoindex?: boolean
  /**
   * Override for fixtures. When omitted, evaluated from robotsInspection
   * for Googlebot against the page path.
   */
  robotsDisallowedGooglebot?: boolean
}

export type CollectHreflangOptions = {
  originUrl: string
  pages: HreflangPageInput[]
  /** Topic 24–28 SitemapInspection — required to see sitemap method (G1). */
  sitemap?: SitemapInspection | null
  robotsInspection?: RobotsTxtInspection | null
}

function headersFrom(input: Headers | undefined): Headers {
  return input ?? new Headers()
}

function linkRelHasAlternate(rel: string | undefined): boolean {
  if (!rel) return false
  return rel
    .toLowerCase()
    .split(/\s+/)
    .some((t) => t === 'alternate')
}

function fromHtml(
  html: string,
  pageUrl: string,
  pageNorm: string,
): { head: HreflangAnnotation[]; body: HreflangAnnotation[] } {
  const parsed = parseHtml(html)
  const head: HreflangAnnotation[] = []
  const body: HreflangAnnotation[] = []

  const collect = (
    els: Array<{ attrs: Record<string, string> }>,
    inHead: boolean,
    sink: HreflangAnnotation[],
  ) => {
    for (const el of els) {
      if (!linkRelHasAlternate(el.attrs.rel)) continue
      const hreflang = el.attrs.hreflang?.trim()
      if (!hreflang) continue
      const href = el.attrs.href?.trim()
      if (!href) continue
      sink.push({
        hreflangRaw: hreflang,
        hrefRaw: href,
        hrefNormalized: normalizeFixStrategyUrl(href, pageUrl),
        method: 'html',
        sourceUrl: pageUrl,
        sourceUrlNormalized: pageNorm,
        inHead,
        hasMedia: Boolean(el.attrs.media?.trim()),
        sitemapLoc: null,
      })
    }
  }

  collect(parsed.headElements('link'), true, head)
  collect(parsed.bodyElements('link'), false, body)
  return { head, body }
}

/**
 * Parse HTTP Link header(s) for rel=alternate + hreflang.
 */
export function extractLinkHeaderHreflang(
  headers: Headers,
  pageUrl: string,
  pageNorm: string,
): HreflangAnnotation[] {
  const single = headers.get('link')
  if (!single) return []

  const out: HreflangAnnotation[] = []
  for (const part of splitLinkHeader(single)) {
    const m = part.match(/^\s*<([^>]+)>\s*(.*)$/s)
    if (!m) continue
    const url = m[1]!.trim()
    const params = m[2] ?? ''
    if (!linkParamHasAlternateRel(params)) continue
    const hreflang = linkParamValue(params, 'hreflang')
    if (!hreflang) continue
    const media = linkParamValue(params, 'media')
    out.push({
      hreflangRaw: hreflang,
      hrefRaw: url,
      hrefNormalized: normalizeFixStrategyUrl(url, pageUrl),
      method: 'http-link',
      sourceUrl: pageUrl,
      sourceUrlNormalized: pageNorm,
      inHead: null,
      hasMedia: Boolean(media),
      sitemapLoc: null,
    })
  }
  return out
}

function linkParamHasAlternateRel(params: string): boolean {
  const rel = linkParamValue(params, 'rel')
  if (!rel) return false
  return rel
    .toLowerCase()
    .split(/\s+/)
    .includes('alternate')
}

function linkParamValue(params: string, name: string): string | null {
  const quoted = params.match(
    new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'),
  )
  if (quoted) return quoted[1]!.trim() || null
  const singleQuoted = params.match(
    new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'),
  )
  if (singleQuoted) return singleQuoted[1]!.trim() || null
  const bare = params.match(
    new RegExp(`\\b${name}\\s*=\\s*([^\\s;,]+)`, 'i'),
  )
  if (bare) return bare[1]!.trim() || null
  return null
}

/**
 * Collect sitemap-method annotations keyed by the declaring page <loc>.
 */
export function collectSitemapHreflangAnnotations(
  sitemap: SitemapInspection,
): Map<string, HreflangAnnotation[]> {
  const byLoc = new Map<string, HreflangAnnotation[]>()

  for (const doc of sitemap.documents) {
    if (!doc.parsed || doc.parsed.kind !== 'urlset') continue
    for (const entry of doc.parsed.urlEntries) {
      if (!entry.loc) continue
      const locNorm = normalizeFixStrategyUrl(entry.loc, doc.url)
      if (!locNorm) continue
      const links =
        entry.hreflangLinks.length > 0
          ? entry.hreflangLinks
          : extractSitemapHreflangLinks(entry.rawBlock)
      if (links.length === 0) continue
      const list = byLoc.get(locNorm) ?? []
      for (const link of links) {
        list.push(annotationFromSitemapLink(link, entry.loc, locNorm, doc.url))
      }
      byLoc.set(locNorm, list)
    }
  }
  return byLoc
}

function annotationFromSitemapLink(
  link: SitemapHreflangLink,
  locRaw: string,
  locNorm: string,
  sitemapDocUrl: string,
): HreflangAnnotation {
  return {
    hreflangRaw: link.hreflang,
    hrefRaw: link.href,
    hrefNormalized: normalizeFixStrategyUrl(link.href, sitemapDocUrl),
    method: 'sitemap',
    sourceUrl: locRaw,
    sourceUrlNormalized: locNorm,
    inHead: null,
    hasMedia: false,
    sitemapLoc: locRaw,
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return '/'
  }
}

/**
 * Build the shared hreflang inspection all three topics classify from.
 */
export function collectHreflangAnnotations(
  options: CollectHreflangOptions,
): HreflangInspection {
  const originNorm =
    normalizeFixStrategyUrl(options.originUrl) ?? options.originUrl
  const sitemapByLoc = options.sitemap
    ? collectSitemapHreflangAnnotations(options.sitemap)
    : new Map<string, HreflangAnnotation[]>()

  const pages: PageHreflangRecord[] = []
  const pageByNormalizedUrl = new Map<string, PageHreflangRecord>()
  const seen = new Set<string>()

  for (const input of options.pages) {
    const pageNorm =
      normalizeFixStrategyUrl(input.url, options.originUrl) ?? input.url
    if (seen.has(pageNorm)) continue
    seen.add(pageNorm)

    const headers = headersFrom(input.headers)
    const html = input.html ?? ''
    const contentType = input.contentType ?? 'text/html'

    let htmlHead: HreflangAnnotation[] = []
    let htmlBody: HreflangAnnotation[] = []
    if (html) {
      const from = fromHtml(html, input.url, pageNorm)
      htmlHead = from.head
      htmlBody = from.body
    }

    const headerAnnotations = extractLinkHeaderHreflang(
      headers,
      input.url,
      pageNorm,
    )
    const sitemapAnnotations = sitemapByLoc.get(pageNorm) ?? []
    sitemapByLoc.delete(pageNorm)

    let robotsDisallowed = input.robotsDisallowedGooglebot ?? false
    if (
      input.robotsDisallowedGooglebot === undefined &&
      options.robotsInspection
    ) {
      const allowed = isPathAllowedFromInspection(
        options.robotsInspection,
        'Googlebot',
        pathOf(input.url),
      )
      robotsDisallowed = !allowed.allowed
    }

    const canonicalNormalized = html
      ? (() => {
          const c = extractHtmlCanonical(html, input.url, contentType)
          return c ? normalizeFixStrategyUrl(c, input.url) : null
        })()
      : null

    const hasNoindex =
      Boolean(html) &&
      hasNoindexDirective(headers, html, contentType)

    const finalUrlNormalized = input.finalUrl
      ? normalizeFixStrategyUrl(input.finalUrl, options.originUrl)
      : pageNorm

    const effectiveAnnotations = [
      ...htmlHead,
      ...headerAnnotations,
      ...sitemapAnnotations,
    ]

    const record: PageHreflangRecord = {
      url: input.url,
      urlNormalized: pageNorm,
      annotations: [
        ...htmlHead,
        ...htmlBody,
        ...headerAnnotations,
        ...sitemapAnnotations,
      ],
      htmlAnnotations: htmlHead,
      headerAnnotations,
      sitemapAnnotations,
      bodyHtmlAnnotations: htmlBody,
      effectiveAnnotations,
      status: input.status ?? null,
      redirectHopCount: input.redirectHopCount ?? 0,
      finalUrlNormalized,
      hasNoindex,
      repoDeclaredNoindex: input.repoDeclaredNoindex ?? false,
      robotsDisallowedGooglebot: robotsDisallowed,
      canonicalNormalized,
    }
    pages.push(record)
    pageByNormalizedUrl.set(pageNorm, record)
  }

  // Sitemap-only pages (declared in sitemap but not in pages input)
  for (const [locNorm, anns] of sitemapByLoc) {
    if (pageByNormalizedUrl.has(locNorm)) continue
    const record: PageHreflangRecord = {
      url: anns[0]?.sourceUrl ?? locNorm,
      urlNormalized: locNorm,
      annotations: anns,
      htmlAnnotations: [],
      headerAnnotations: [],
      sitemapAnnotations: anns,
      bodyHtmlAnnotations: [],
      effectiveAnnotations: anns,
      status: null,
      redirectHopCount: 0,
      finalUrlNormalized: locNorm,
      hasNoindex: false,
      repoDeclaredNoindex: false,
      robotsDisallowedGooglebot: false,
      canonicalNormalized: null,
    }
    pages.push(record)
    pageByNormalizedUrl.set(locNorm, record)
  }

  return {
    originUrl: originNorm,
    pages,
    pageByNormalizedUrl,
  }
}

/** Locale key for comparison (case-insensitive; x-default preserved). */
export function hreflangKey(raw: string): string {
  const t = raw.trim()
  if (t.toLowerCase() === 'x-default') return 'x-default'
  return t.toLowerCase()
}

/**
 * Build locale → target URL map from a page's effective annotations.
 * Last-wins for duplicates (topic 47 reports conflicts separately).
 */
export function localeTargetMap(
  annotations: HreflangAnnotation[],
): Map<string, string> {
  const map = new Map<string, string>()
  for (const a of annotations) {
    if (!a.hrefNormalized) continue
    map.set(hreflangKey(a.hreflangRaw), a.hrefNormalized)
  }
  return map
}

/**
 * True when page B effectively declares an annotation targeting page A
 * (any locale / any of the three methods).
 */
export function declaresReturnTo(
  page: PageHreflangRecord,
  targetNormalized: string,
): boolean {
  return page.effectiveAnnotations.some(
    (a) => a.hrefNormalized === targetNormalized,
  )
}

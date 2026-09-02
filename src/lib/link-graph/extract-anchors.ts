/**
 * Extract every anchor from crawled HTML → link_edges shape.
 * Spec §3.1 — DOM region heuristics for nav/footer/main/sidebar.
 */

import {
  isSameSite,
  normalizeLinkUrl,
  type NormalizeLinkUrlOptions,
} from './normalize'
import type { DomRegion, LinkEdge } from './types'

const REGION_CLASS_RE: Array<{ region: DomRegion; re: RegExp }> = [
  { region: 'nav', re: /\b(nav|navbar|navigation|menu|header-nav|main-nav)\b/i },
  { region: 'footer', re: /\b(footer|site-footer|page-footer)\b/i },
  { region: 'sidebar', re: /\b(sidebar|aside|side-nav)\b/i },
  { region: 'main', re: /\b(main|content|article|post-content|entry-content)\b/i },
]

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseRel(tag: string): string | null {
  const m = tag.match(/\brel=["']([^"']+)["']/i)
  return m?.[1]?.trim() || null
}

function isNofollow(rel: string | null): boolean {
  if (!rel) return false
  return /\bnofollow\b/i.test(rel)
}

function extractImgAlt(inner: string): string | null {
  const m = inner.match(/<img\b[^>]*\balt=["']([^"']*)["']/i)
  if (!m) return null
  const alt = m[1]!.trim()
  return alt || null
}

/**
 * Rough DOM-region guess: scan preceding markup for landmark open tags / classes.
 * Not a full HTML parser — good enough to exclude nav/footer from L14–L16.
 */
export function inferDomRegion(htmlBeforeAnchor: string): DomRegion {
  const tail = htmlBeforeAnchor.slice(-4000)
  const openTags = Array.from(
    tail.matchAll(/<(nav|header|footer|aside|main|div|section)\b([^>]*)>/gi),
  )
  for (let i = openTags.length - 1; i >= 0; i--) {
    const tag = openTags[i]![1]!.toLowerCase()
    const attrs = openTags[i]![2] || ''
    if (tag === 'nav' || /role=["']navigation["']/i.test(attrs)) return 'nav'
    if (tag === 'footer') return 'footer'
    if (tag === 'aside') return 'sidebar'
    if (tag === 'main') return 'main'
    if (tag === 'header') return 'nav'
    for (const { region, re } of REGION_CLASS_RE) {
      if (re.test(attrs)) return region
    }
  }
  return 'unknown'
}

export interface ExtractAnchorsOptions {
  sourceUrl: string
  siteHost: string
  normalizeOpts?: NormalizeLinkUrlOptions
}

export function extractAnchorsFromHtml(
  html: string,
  opts: ExtractAnchorsOptions,
): LinkEdge[] {
  const edges: LinkEdge[] = []
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  let domIndex = 0

  while ((match = anchorRe.exec(html)) !== null) {
    const attrs = match[1] || ''
    const inner = match[2] || ''
    const hrefMatch = attrs.match(/\bhref=["']([^"']*)["']/i)
    const hrefRaw = hrefMatch ? hrefMatch[1]! : ''
    const before = html.slice(0, match.index)
    const domRegion = inferDomRegion(before)
    const rel = parseRel(attrs)
    const anchorText = stripTags(inner)
    const anchorImageAlt = anchorText ? null : extractImgAlt(inner)

    const resolved = normalizeLinkUrl(hrefRaw || '#', {
      ...opts.normalizeOpts,
      baseUrl: opts.sourceUrl,
    })

    // Keep placeholder hrefs as edges with empty resolved for L20
    const hrefResolved =
      resolved ||
      (hrefRaw === '#' || !hrefRaw.trim() || /^javascript:/i.test(hrefRaw)
        ? hrefRaw.trim() || '#'
        : '')

    if (!hrefResolved && !hrefRaw) continue

    const isInternal =
      Boolean(resolved) && isSameSite(resolved!, opts.siteHost)

    edges.push({
      sourceUrl: opts.sourceUrl,
      hrefRaw,
      hrefResolved: resolved || hrefResolved,
      anchorText,
      anchorImageAlt,
      rel,
      isNofollow: isNofollow(rel),
      isInternal,
      domRegion,
      domIndex: domIndex++,
    })
  }

  return edges
}

export function extractAllEdges(
  htmlByUrl: Record<string, string>,
  siteHost: string,
  normalizeOpts?: NormalizeLinkUrlOptions,
): LinkEdge[] {
  const all: LinkEdge[] = []
  for (const [url, html] of Object.entries(htmlByUrl)) {
    all.push(
      ...extractAnchorsFromHtml(html, {
        sourceUrl: url,
        siteHost,
        normalizeOpts,
      }),
    )
  }
  return all
}

/** Pages that look like SPAs for L00 (few internal anchors, 200, substantial body). */
export function detectJsSuspectedPages(
  htmlByUrl: Record<string, string>,
  edges: LinkEdge[],
  pages: Array<{ url: string; httpStatus: number }>,
  siteHost: string,
): string[] {
  const suspected: string[] = []
  const bySource = new Map<string, number>()
  for (const e of edges) {
    if (!e.isInternal) continue
    bySource.set(e.sourceUrl, (bySource.get(e.sourceUrl) || 0) + 1)
  }

  for (const page of pages) {
    if (page.httpStatus < 200 || page.httpStatus >= 300) continue
    const html = htmlByUrl[page.url]
    if (!html) continue
    const textLen = stripTags(html).length
    if (textLen < 200) continue
    const internalCount = bySource.get(page.url) || 0
    if (internalCount < 3) {
      // Only flag if page itself looks same-site
      if (isSameSite(page.url, siteHost)) suspected.push(page.url)
    }
  }
  return suspected
}

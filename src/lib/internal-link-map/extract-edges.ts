/**
 * Internal anchors from already-fetched crawl HTML.
 * Reuses topic-1 skip rules and topic-74 malformation filter — no extra fetch.
 */

import {
  isSkippableHref,
} from '@/lib/fix-strategies/topic-1/extract-anchors'
import { classifyOriginPrefixedHref } from '@/lib/fix-strategies/topic-74/detect'
import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared'
import type { CrawlLinkEdge } from './types'

const A_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
const HREF_RE =
  /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|[\u201C\u201D]([^\u201C\u201D]*)[\u201C\u201D]|[\u2018\u2019]([^\u2018\u2019]*)[\u2018\u2019]|([^\s>]+))/i
const REL_RE = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i

const MAX_EDGES_PER_PAGE = 300

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function parseAttrGroup(match: RegExpMatchArray | null): string {
  if (!match) return ''
  return (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '').trim()
}

function stripAnchorText(inner: string): string {
  return inner
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isNofollow(rel: string): boolean {
  return /\bnofollow\b/i.test(rel)
}

export function extractCrawlLinkEdges(
  html: string,
  pageUrl: string,
  origin: string,
): CrawlLinkEdge[] {
  const originHost = hostOf(origin)
  if (!originHost || !html) return []
  const sourceUrl = normalizeFixStrategyUrl(pageUrl, origin) ?? pageUrl
  const out: CrawlLinkEdge[] = []

  for (const match of html.matchAll(A_RE)) {
    if (out.length >= MAX_EDGES_PER_PAGE) break
    const attrs = match[1] ?? ''
    const inner = match[2] ?? ''
    const hrefRaw = parseAttrGroup(attrs.match(HREF_RE))
    if (!hrefRaw || isSkippableHref(hrefRaw)) continue
    if (classifyOriginPrefixedHref(hrefRaw, pageUrl)) continue

    let resolved: URL
    try {
      resolved = new URL(hrefRaw, pageUrl)
    } catch {
      continue
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      continue
    }
    if (resolved.hostname.toLowerCase() !== originHost) continue

    const targetUrl = normalizeFixStrategyUrl(resolved.href, pageUrl)
    if (!targetUrl) continue

    const rel = parseAttrGroup(attrs.match(REL_RE))
    out.push({
      sourceUrl,
      targetUrl,
      hrefRaw,
      anchorText: stripAnchorText(inner),
      isNofollow: isNofollow(rel),
      targetHttpStatus: null,
      targetFinalUrl: null,
      isRedirect: false,
    })
  }
  return out
}

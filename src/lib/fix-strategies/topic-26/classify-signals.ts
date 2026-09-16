/**
 * Topic 26 — structural signals from a fetched response (headers + HTML tree).
 * Uses the shared HTML parser — not regex on page prose.
 */

import { parseHtml } from '../shared/html-parser'
import { normalizeFixStrategyUrl } from '../shared/url-normalize'

export function hasNoindexDirective(
  headers: Headers,
  body: string,
  contentType: string | null,
): boolean {
  const xRobots = headers.get('x-robots-tag')
  if (xRobots && /\bnoindex\b/i.test(xRobots)) return true

  if (!isHtmlContentType(contentType) && !looksLikeHtml(body)) return false

  const parsed = parseHtml(body)
  for (const meta of parsed.headElements('meta')) {
    const name = (meta.attrs.name ?? meta.attrs.Name ?? '').toLowerCase()
    if (name !== 'robots' && name !== 'googlebot') continue
    const content = meta.attrs.content ?? meta.attrs.Content ?? ''
    if (/\bnoindex\b/i.test(content)) return true
  }
  return false
}

export function extractHtmlCanonical(
  body: string,
  pageUrl: string,
  contentType: string | null,
): string | null {
  if (!isHtmlContentType(contentType) && !looksLikeHtml(body)) return null
  const parsed = parseHtml(body)
  for (const link of parsed.headElements('link')) {
    const rel = (link.attrs.rel ?? '').toLowerCase().split(/\s+/)
    if (!rel.includes('canonical')) continue
    const href = link.attrs.href?.trim()
    if (!href) continue
    return normalizeFixStrategyUrl(href, pageUrl)
  }
  return null
}

export function isSelfCanonical(
  pageUrl: string,
  canonical: string | null,
): boolean {
  if (canonical == null) return true // no canonical ≠ "canonicalises elsewhere"
  const page = normalizeFixStrategyUrl(pageUrl)
  const canon = normalizeFixStrategyUrl(canonical)
  if (!page || !canon) return false
  return page === canon
}

export function isNonHtmlIndexableResource(
  contentType: string | null,
  url: string,
): boolean {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('application/pdf')) return true
  if (ct.includes('image/')) return true
  if (ct.includes('application/xml') && url.toLowerCase().endsWith('.xml')) {
    return false
  }
  // URL heuristic only when content-type absent (fixture convenience).
  if (!ct && /\.pdf(\?|$)/i.test(url)) return true
  return false
}

function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false
  return /text\/html|application\/xhtml\+xml/i.test(contentType)
}

function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 256).toLowerCase()
  return head.includes('<html') || head.includes('<!doctype html')
}

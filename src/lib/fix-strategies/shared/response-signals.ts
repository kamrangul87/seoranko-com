/**
 * Structural response signals (headers + HTML tree) shared across topics.
 * Uses the shared HTML parser — not regex on page prose.
 *
 * Canonical extraction is a thin wrapper over `extractCanonicalDeclarations`
 * (topics 13–17). Do not add a second extractor here.
 */

import { parseHtml } from './html-parser'
import { normalizeFixStrategyUrl } from './url-normalize'
import { extractCanonicalDeclarations } from './canonical-extraction'

export function hasNoindexDirective(
  headers: Headers,
  body: string,
  contentType: string | null,
): boolean {
  const xRobots = headers.get('x-robots-tag')
  if (xRobots && /\bnoindex\b/i.test(xRobots)) return true

  if (!isHtmlContentType(contentType) && !looksLikeHtml(body)) return false

  const parsed = parseHtml(body)
  // R8: robots meta IS respected in <body> (unlike canonical C2). Check both.
  for (const meta of [
    ...parsed.headElements('meta'),
    ...parsed.bodyElements('meta'),
  ]) {
    const name = (meta.attrs.name ?? meta.attrs.Name ?? '').toLowerCase()
    if (name !== 'robots' && name !== 'googlebot') continue
    const content = meta.attrs.content ?? meta.attrs.Content ?? ''
    if (/\bnoindex\b/i.test(content)) return true
  }
  return false
}

/**
 * First (and only when unique) head canonical — body-only does not count (C2).
 * Prefer `extractCanonicalDeclarations` when callers need header/body/multi.
 */
export function extractHtmlCanonical(
  body: string,
  pageUrl: string,
  contentType: string | null,
): string | null {
  const extracted = extractCanonicalDeclarations(
    body,
    new Headers(),
    pageUrl,
    contentType,
  )
  return extracted.effectiveHead?.normalized ?? null
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

function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false
  return /text\/html|application\/xhtml\+xml/i.test(contentType)
}

function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 256).toLowerCase()
  return head.includes('<html') || head.includes('<!doctype html')
}

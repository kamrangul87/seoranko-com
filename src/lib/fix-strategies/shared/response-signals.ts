/**
 * Structural response signals (headers + HTML tree) shared across topics.
 * Uses the shared HTML parser — not regex on page prose.
 */

import { parseHtml } from './html-parser'

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

function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false
  return /text\/html|application\/xhtml\+xml/i.test(contentType)
}

function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 256).toLowerCase()
  return head.includes('<html') || head.includes('<!doctype html')
}

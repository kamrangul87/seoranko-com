/**
 * Title / H1 / noindex / text snippet from stored crawl HTML.
 * Deterministic, no network, no model.
 */

import { decodeHtmlEntities } from '@/lib/fix-strategies/related-articles/anchors'

export type PageSignals = {
  title: string | null
  h1: string | null
  headings: string[]
  noindex: boolean
  text: string
}

function stripTags(inner: string): string {
  return decodeHtmlEntities(
    inner
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function metaContent(
  html: string,
  name: string,
): string | null {
  const re = new RegExp(
    `<meta\\b[^>]*\\bname\\s*=\\s*["']${name}["'][^>]*>`,
    'i',
  )
  const tag = html.match(re)?.[0]
  if (!tag) return null
  const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)
  return content?.[1] ?? null
}

const CHROME_RE = /<(nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi

function stripChrome(html: string): string {
  return html.replace(CHROME_RE, ' ')
}

function contentHtml(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html
  const stripped = stripChrome(body)
  return (
    stripped.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
    stripped.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
    stripped
  )
}

function extractHeadings(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const t = stripTags(m[2] || '')
    if (t) out.push(t)
  }
  return out
}

export function extractPageSignals(html: string): PageSignals {
  if (!html) {
    return { title: null, h1: null, headings: [], noindex: false, text: '' }
  }
  const titleRaw = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const h1Raw = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const robots = `${metaContent(html, 'robots') || ''} ${metaContent(html, 'googlebot') || ''}`
  const main = contentHtml(html)
  const headings = extractHeadings(main)
  const text = stripTags(main).slice(0, 1200)
  return {
    title: titleRaw ? stripTags(titleRaw) || null : null,
    h1: h1Raw ? stripTags(h1Raw) || null : null,
    headings,
    noindex: /\bnoindex\b/i.test(robots),
    text,
  }
}

/**
 * Title / H1 / noindex / text snippet from stored crawl HTML.
 * Deterministic, no network, no model.
 */

export type PageSignals = {
  title: string | null
  h1: string | null
  noindex: boolean
  text: string
}

function stripTags(inner: string): string {
  return inner
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

export function extractPageSignals(html: string): PageSignals {
  if (!html) {
    return { title: null, h1: null, noindex: false, text: '' }
  }
  const titleRaw = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const h1Raw = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const robots = `${metaContent(html, 'robots') || ''} ${metaContent(html, 'googlebot') || ''}`
  const bodyRaw = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html
  const text = stripTags(bodyRaw).slice(0, 800)
  return {
    title: titleRaw ? stripTags(titleRaw) || null : null,
    h1: h1Raw ? stripTags(h1Raw) || null : null,
    noindex: /\bnoindex\b/i.test(robots),
    text,
  }
}

/**
 * Extract dateModified from JSON-LD when present — never invent dates.
 */

function extractJsonLdBlocks(html: string): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim())
      if (Array.isArray(parsed)) blocks.push(...parsed.filter((x) => x && typeof x === 'object'))
      else if (parsed && typeof parsed === 'object') blocks.push(parsed)
    } catch {
      /* ignore bad JSON-LD */
    }
  }
  return blocks
}

function findDateModified(blocks: Array<Record<string, unknown>>): string | null {
  for (const b of blocks) {
    if (typeof b.dateModified === 'string' && b.dateModified.trim()) return b.dateModified.trim()
    const graph = b['@graph']
    if (Array.isArray(graph)) {
      for (const g of graph) {
        if (g && typeof g === 'object' && typeof (g as { dateModified?: string }).dateModified === 'string') {
          const v = (g as { dateModified: string }).dateModified.trim()
          if (v) return v
        }
      }
    }
  }
  return null
}

/** Return ISO-like lastmod only when JSON-LD dateModified is present in crawl HTML. */
export function lastmodFromHtml(html: string | undefined): string | undefined {
  if (!html?.trim()) return undefined
  const raw = findDateModified(extractJsonLdBlocks(html))
  if (!raw) return undefined
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) return undefined
  return new Date(parsed).toISOString()
}

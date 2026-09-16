/**
 * Topic 26 — parse sitemap XML for `<loc>` values.
 * Structural XML extraction only — not page-content text matching.
 *
 * Edits operate on discrete `<url>` blocks so a remove never spans neighbours.
 */

const URL_BLOCK_RE = /<url\b[^>]*>[\s\S]*?<\/url\s*>/gi
const LOC_RE = /<loc\s*>([\s\S]*?)<\/loc\s*>/i

export function extractSitemapLocs(sitemapXml: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const block of sitemapXml.match(URL_BLOCK_RE) ?? []) {
    const loc = locFromBlock(block)
    if (!loc || seen.has(loc)) continue
    seen.add(loc)
    out.push(loc)
  }
  return out
}

function locFromBlock(block: string): string | null {
  const m = LOC_RE.exec(block)
  if (!m) return null
  return (m[1] ?? '').trim() || null
}

/**
 * Remove every `<url>…</url>` block whose `<loc>` equals `loc`.
 */
export function removeSitemapLoc(
  sitemapXml: string,
  loc: string,
): { xml: string; removed: number } {
  let removed = 0
  const xml = sitemapXml.replace(URL_BLOCK_RE, (block) => {
    if (locFromBlock(block) === loc) {
      removed += 1
      return ''
    }
    return block
  })
  // Collapse leftover blank lines from removals
  return {
    xml: xml.replace(/\n{3,}/g, '\n\n'),
    removed,
  }
}

/**
 * Replace the text of a `<loc>` that equals `from` with `to`.
 */
export function replaceSitemapLoc(
  sitemapXml: string,
  from: string,
  to: string,
): { xml: string; replaced: number } {
  let replaced = 0
  const xml = sitemapXml.replace(URL_BLOCK_RE, (block) => {
    if (locFromBlock(block) !== from) return block
    replaced += 1
    return block.replace(LOC_RE, `<loc>${to}</loc>`)
  })
  return { xml, replaced }
}

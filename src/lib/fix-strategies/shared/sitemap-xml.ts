/**
 * Sitemap XML parsing for topics 24–28 (and topic 26).
 *
 * Structural extraction only — not page-content text matching.
 * Reuses the same `<url>` / `<loc>` block discipline as the original
 * topic-26 parser so removes never span neighbours.
 */

export const SITEMAP_NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9'
export const SITEMAP_MAX_URLS = 50_000
/** 50 MB uncompressed / decompressed (S10, S11). */
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024
/** loc must be under 2,048 characters (S3). */
export const SITEMAP_MAX_LOC_CHARS = 2_048

const URL_BLOCK_RE = /<url\b[^>]*>[\s\S]*?<\/url\s*>/gi
const SITEMAP_BLOCK_RE = /<sitemap\b[^>]*>[\s\S]*?<\/sitemap\s*>/gi
const LOC_RE = /<loc\s*>([\s\S]*?)<\/loc\s*>/i
const LASTMOD_RE = /<lastmod\s*>([\s\S]*?)<\/lastmod\s*>/i
const CHANGEFREQ_RE = /<changefreq\s*>([\s\S]*?)<\/changefreq\s*>/i
const PRIORITY_RE = /<priority\s*>([\s\S]*?)<\/priority\s*>/i

export type SitemapKind = 'urlset' | 'sitemapindex' | 'unknown'

export type SitemapUrlEntry = {
  loc: string | null
  lastmod: string | null
  changefreq: string | null
  priority: string | null
  rawBlock: string
}

export type SitemapIndexEntry = {
  loc: string | null
  lastmod: string | null
  rawBlock: string
}

export type ParsedSitemapXml = {
  kind: SitemapKind
  /** Declared xmlns on the root element (may be wrong / missing). */
  namespace: string | null
  namespaceOk: boolean
  /** True when the document looks like well-formed enough XML to parse. */
  xmlParses: boolean
  /** Heuristic: unescaped bare `&` not part of an entity. */
  hasUnescapedEntities: boolean
  /** UTF-8 BOM present or content looks like UTF-8 text. */
  appearsUtf8: boolean
  urlEntries: SitemapUrlEntry[]
  indexEntries: SitemapIndexEntry[]
  /** Distinct non-null locs from urlset (or empty for index). */
  locs: string[]
  /** Child sitemap locs from a sitemapindex. */
  childSitemapLocs: string[]
  hasChangefreq: boolean
  hasPriority: boolean
  /** All lastmod values present (for bulk-identical check). */
  lastmodValues: string[]
  lastmodBulkIdentical: boolean
}

function locFromBlock(block: string): string | null {
  const m = LOC_RE.exec(block)
  if (!m) return null
  return decodeXmlText((m[1] ?? '').trim()) || null
}

function fieldFromBlock(block: string, re: RegExp): string | null {
  const m = re.exec(block)
  if (!m) return null
  return decodeXmlText((m[1] ?? '').trim()) || null
}

function decodeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Extract `<loc>` values from a urlset (topic 26 API).
 */
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

/**
 * Full structural parse of a sitemap or sitemap index document.
 */
export function parseSitemapXml(sitemapXml: string): ParsedSitemapXml {
  const trimmed = sitemapXml.replace(/^\uFEFF/, '')
  const appearsUtf8 = !containsObviousNonUtf8(trimmed)

  const hasUrlset = /<urlset\b/i.test(trimmed)
  const hasIndex = /<sitemapindex\b/i.test(trimmed)
  let kind: SitemapKind = 'unknown'
  if (hasIndex && !hasUrlset) kind = 'sitemapindex'
  else if (hasUrlset) kind = 'urlset'
  else if (hasIndex) kind = 'sitemapindex'

  const rootMatch =
    trimmed.match(/<(urlset|sitemapindex)\b([^>]*)>/i) ?? null
  const rootAttrs = rootMatch?.[2] ?? ''
  const nsMatch = rootAttrs.match(/\bxmlns\s*=\s*["']([^"']+)["']/i)
  const namespace = nsMatch?.[1] ?? null
  const namespaceOk = namespace === SITEMAP_NAMESPACE

  // Minimal well-formedness: root opens and closes
  const xmlParses =
    kind !== 'unknown' &&
    ((kind === 'urlset' && /<\/urlset\s*>/i.test(trimmed)) ||
      (kind === 'sitemapindex' && /<\/sitemapindex\s*>/i.test(trimmed)))

  const hasUnescapedEntities = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(
    trimmed,
  )

  const urlEntries: SitemapUrlEntry[] = []
  for (const block of trimmed.match(URL_BLOCK_RE) ?? []) {
    urlEntries.push({
      loc: locFromBlock(block),
      lastmod: fieldFromBlock(block, LASTMOD_RE),
      changefreq: fieldFromBlock(block, CHANGEFREQ_RE),
      priority: fieldFromBlock(block, PRIORITY_RE),
      rawBlock: block,
    })
  }

  const indexEntries: SitemapIndexEntry[] = []
  for (const block of trimmed.match(SITEMAP_BLOCK_RE) ?? []) {
    indexEntries.push({
      loc: locFromBlock(block),
      lastmod: fieldFromBlock(block, LASTMOD_RE),
      rawBlock: block,
    })
  }

  const locs: string[] = []
  const seen = new Set<string>()
  for (const e of urlEntries) {
    if (!e.loc || seen.has(e.loc)) continue
    seen.add(e.loc)
    locs.push(e.loc)
  }

  const childSitemapLocs: string[] = []
  const seenChild = new Set<string>()
  for (const e of indexEntries) {
    if (!e.loc || seenChild.has(e.loc)) continue
    seenChild.add(e.loc)
    childSitemapLocs.push(e.loc)
  }

  const lastmodValues = urlEntries
    .map((e) => e.lastmod)
    .filter((v): v is string => v != null && v.length > 0)
  const lastmodBulkIdentical =
    lastmodValues.length >= 2 &&
    lastmodValues.every((v) => v === lastmodValues[0])

  return {
    kind,
    namespace,
    namespaceOk: kind === 'unknown' ? false : namespaceOk,
    xmlParses: kind === 'unknown' ? false : xmlParses,
    hasUnescapedEntities,
    appearsUtf8,
    urlEntries,
    indexEntries,
    locs,
    childSitemapLocs,
    hasChangefreq: urlEntries.some((e) => e.changefreq != null),
    hasPriority: urlEntries.some((e) => e.priority != null),
    lastmodValues,
    lastmodBulkIdentical,
  }
}

function containsObviousNonUtf8(s: string): boolean {
  if (s.includes('\uFFFD')) return true
  if (s.includes('\0')) return true
  return false
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
    return block.replace(LOC_RE, `<loc>${escapeXmlText(to)}</loc>`)
  })
  return { xml, replaced }
}

export function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Make a relative loc absolute against the sitemap document URL. */
export function absolutizeLoc(loc: string, sitemapUrl: string): string | null {
  try {
    return new URL(loc, sitemapUrl).href
  } catch {
    return null
  }
}

export function isAbsoluteHttpLoc(loc: string): boolean {
  try {
    const u = new URL(loc)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Fix xmlns on urlset/sitemapindex root to the protocol namespace.
 */
export function ensureSitemapNamespace(sitemapXml: string): string {
  return sitemapXml.replace(
    /<(urlset|sitemapindex)\b([^>]*)>/i,
    (_m, tag: string, attrs: string) => {
      if (/\bxmlns\s*=/.test(attrs)) {
        const fixed = attrs.replace(
          /\bxmlns\s*=\s*["'][^"']*["']/i,
          `xmlns="${SITEMAP_NAMESPACE}"`,
        )
        return `<${tag}${fixed}>`
      }
      return `<${tag} xmlns="${SITEMAP_NAMESPACE}"${attrs}>`
    },
  )
}

/** Strip changefreq and priority elements (safe — Google ignores them). */
export function stripChangefreqAndPriority(sitemapXml: string): string {
  return sitemapXml
    .replace(/<changefreq\b[^>]*>[\s\S]*?<\/changefreq\s*>/gi, '')
    .replace(/<priority\b[^>]*>[\s\S]*?<\/priority\s*>/gi, '')
}

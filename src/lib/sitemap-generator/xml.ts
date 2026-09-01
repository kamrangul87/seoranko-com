import type { SitemapFile, SitemapUrlEntry } from './types'

const SITEMAP_NS = 'http://www.sitemaps.org/schemas/sitemap/0.9'
const MAX_URLS_PER_FILE = 50_000
const MAX_BYTES_PER_FILE = 50 * 1024 * 1024

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function urlEntryXml(entry: SitemapUrlEntry): string {
  const lines = [`  <url>`, `    <loc>${escapeXml(entry.loc)}</loc>`]
  if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`)
  lines.push(`  </url>`)
  return lines.join('\n')
}

export function buildUrlsetXml(entries: SitemapUrlEntry[]): string {
  const body = entries.map(urlEntryXml).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${SITEMAP_NS}">\n${body}\n</urlset>\n`
}

export function buildSitemapIndexXml(sitemapLocs: string[]): string {
  const body = sitemapLocs
    .map((loc) => `  <sitemap>\n    <loc>${escapeXml(loc)}</loc>\n  </sitemap>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="${SITEMAP_NS}">\n${body}\n</sitemapindex>\n`
}

function splitEntriesByLimits(entries: SitemapUrlEntry[], maxUrls: number): SitemapUrlEntry[][] {
  const chunks: SitemapUrlEntry[][] = []
  let i = 0
  while (i < entries.length) {
    let end = Math.min(i + maxUrls, entries.length)
    let chunk = entries.slice(i, end)
    while (chunk.length > 1 && Buffer.byteLength(buildUrlsetXml(chunk), 'utf8') > MAX_BYTES_PER_FILE) {
      end = i + Math.ceil((end - i) / 2)
      chunk = entries.slice(i, end)
    }
    chunks.push(chunk)
    i = end
  }
  return chunks
}

/** Build sitemap.xml or split files + sitemap-index.xml when limits exceeded. */
export function buildSitemapFiles(
  entries: SitemapUrlEntry[],
  publicBaseUrl: string,
  opts?: { maxUrlsPerFile?: number },
): SitemapFile[] {
  const maxUrls = opts?.maxUrlsPerFile ?? MAX_URLS_PER_FILE
  if (entries.length === 0) {
    return [{ filename: 'sitemap.xml', content: buildUrlsetXml([]), urlCount: 0 }]
  }

  const singleXml = buildUrlsetXml(entries)
  if (entries.length <= maxUrls && Buffer.byteLength(singleXml, 'utf8') <= MAX_BYTES_PER_FILE) {
    return [{ filename: 'sitemap.xml', content: singleXml, urlCount: entries.length }]
  }

  const chunks = splitEntriesByLimits(entries, maxUrls)
  const base = publicBaseUrl.replace(/\/$/, '')
  const partFiles: SitemapFile[] = chunks.map((chunk, i) => ({
    filename: `sitemap-${i + 1}.xml`,
    content: buildUrlsetXml(chunk),
    urlCount: chunk.length,
  }))

  const indexLocs = partFiles.map((f) => `${base}/${f.filename}`)
  const indexFile: SitemapFile = {
    filename: 'sitemap-index.xml',
    content: buildSitemapIndexXml(indexLocs),
    urlCount: partFiles.length,
  }

  return [...partFiles, indexFile]
}

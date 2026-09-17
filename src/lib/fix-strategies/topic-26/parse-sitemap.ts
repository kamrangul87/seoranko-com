/**
 * Topic 26 parse API — re-exports shared sitemap-xml helpers.
 * Prefer importing from `@/lib/fix-strategies/shared` for new topics.
 */

export {
  extractSitemapLocs,
  removeSitemapLoc,
  replaceSitemapLoc,
  parseSitemapXml,
  SITEMAP_NAMESPACE,
  SITEMAP_MAX_URLS,
  SITEMAP_MAX_BYTES,
  SITEMAP_MAX_LOC_CHARS,
} from '../shared/sitemap-xml'
export type {
  ParsedSitemapXml,
  SitemapUrlEntry,
  SitemapIndexEntry,
  SitemapKind,
} from '../shared/sitemap-xml'

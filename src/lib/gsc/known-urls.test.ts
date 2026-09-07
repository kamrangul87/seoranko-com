import { describe, expect, it } from 'vitest'
import { buildKnownUrlSet, filterRowsToKnownUrls } from './known-urls'

describe('buildKnownUrlSet', () => {
  it('normalizes crawl + sitemap URLs and dedupes www / trailing slash', () => {
    const urls = buildKnownUrlSet({
      pageUrls: ['https://www.example.com/blog/', 'https://example.com/about'],
      sitemapUrls: ['https://example.com/blog', 'https://example.com/pricing/'],
    })
    expect(urls.has('https://example.com/blog')).toBe(true)
    expect(urls.has('https://example.com/about')).toBe(true)
    expect(urls.has('https://example.com/pricing')).toBe(true)
    expect(urls.size).toBe(3)
  })
})

describe('filterRowsToKnownUrls', () => {
  it('keeps only GSC pages present in the crawl/sitemap allowlist', () => {
    const allowlist = buildKnownUrlSet({
      pageUrls: ['https://example.com/', 'https://example.com/blog/post-1'],
    })
    const { kept, dropped } = filterRowsToKnownUrls(
      [
        { page: 'https://www.example.com/', date: '2026-09-01' },
        { page: 'https://example.com/blog/post-1/', date: '2026-09-01' },
        { page: 'https://example.com/old-deleted-page', date: '2026-09-01' },
        { page: 'https://example.com/?utm=1', date: '2026-09-01' },
      ],
      allowlist,
    )
    expect(kept.map((r) => r.page)).toEqual([
      'https://www.example.com/',
      'https://example.com/blog/post-1/',
      'https://example.com/?utm=1',
    ])
    expect(dropped).toBe(1)
  })

  it('drops everything when allowlist is empty (never ingest full GSC dump)', () => {
    const { kept, dropped } = filterRowsToKnownUrls(
      [{ page: 'https://example.com/', date: '2026-09-01' }],
      new Set(),
    )
    expect(kept).toEqual([])
    expect(dropped).toBe(1)
  })
})

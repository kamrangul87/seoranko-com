import { describe, expect, it } from 'vitest'
import { generateSitemap } from './generate'
import { buildSitemapFiles, buildUrlsetXml } from './xml'
import { lastmodFromHtml } from './lastmod'
import type { SitemapCrawlInput } from './types'
import type { PageIndexability } from '@/lib/index-diagnosis/types'

function mockInput(pages: PageIndexability[], overrides: Partial<SitemapCrawlInput> = {}): SitemapCrawlInput {
  return {
    domain: 'autodun.com',
    seedUrl: 'https://autodun.com/',
    pages,
    coverage: {
      domain: 'autodun.com',
      seedUrl: 'https://autodun.com/',
      discoveredCount: 10,
      fetchedCount: pages.length,
      excluded: [],
      excludedByReason: {
        ROBOTS_DISALLOWED: 0,
        META_NOINDEX: 0,
        X_ROBOTS_NOINDEX: 0,
        NON_200: 0,
        DEPTH_LIMIT: 0,
        TIMEOUT: 0,
        PLAN_LIMIT: 0,
        REDIRECT_CHAIN: 0,
        NOT_REACHED: 0,
      },
      terminationReason: 'QUEUE_EMPTY',
      terminationEvidence: 'done',
      discoverySources: { sitemap: 0, links: 5, both: 0, seed: 1 },
      sitemapOnlyUrls: ['https://autodun.com/old-page.html'],
      linkedOnlyUrls: ['https://autodun.com/mot-predictor'],
      sitemapDiscoveredUrls: ['https://autodun.com/'],
      robotsTxtFetched: true,
      robotsTxtEvidence: 'ok',
    },
    robotsTxt: 'User-agent: *\nDisallow:',
    ranAt: '2026-09-01T00:00:00.000Z',
    crawlSource: 'fresh',
    ...overrides,
  }
}

function page(url: string, verdict: PageIndexability['verdict'], html?: string): PageIndexability {
  return {
    url,
    verdict,
    decisiveStep: null,
    decisiveEvidence: verdict,
    steps: [],
    httpStatus: 200,
    crawlDepth: 1,
    internalLinksIn: 1,
    inboundLinks: [],
    duplicateClusterId: null,
    duplicateClusterSize: 1,
    mainContentFingerprint: 'fp',
    pathPattern: '/',
    depthBand: '1',
    pageTitle: 'Title',
    pageH1: 'H1',
    ...(html ? {} : {}),
  }
}

describe('sitemap-generator', () => {
  it('includes only INDEXABLE URLs and omits priority/changefreq', () => {
    const pages = [
      page('https://autodun.com/', 'INDEXABLE'),
      page('https://autodun.com/mot-predictor', 'INDEXABLE'),
      page('https://autodun.com/blog/index.html', 'AT_RISK'),
      page('https://autodun.com/private', 'BLOCKED'),
    ]
    const result = generateSitemap(mockInput(pages))
    const main = result.files.find((f) => f.filename === 'sitemap.xml')!
    expect(main.content).toContain('<loc>https://autodun.com/</loc>')
    expect(main.content).toContain('<loc>https://autodun.com/mot-predictor</loc>')
    expect(main.content).not.toContain('blog/index.html')
    expect(main.content).not.toContain('private')
    expect(main.content).not.toMatch(/<priority>/)
    expect(main.content).not.toMatch(/<changefreq>/)
    expect(result.indexableCount).toBe(2)
  })

  it('adds lastmod only when JSON-LD dateModified exists', () => {
    const html = `<script type="application/ld+json">{"@type":"Article","dateModified":"2026-08-01T09:00:00.000Z"}</script>`
    expect(lastmodFromHtml(html)).toBe('2026-08-01T09:00:00.000Z')
    expect(lastmodFromHtml('<html></html>')).toBeUndefined()

    const pages = [page('https://autodun.com/article', 'INDEXABLE')]
    const result = generateSitemap(
      mockInput(pages, { htmlByUrl: { 'https://autodun.com/article': html } }),
    )
    expect(result.files[0].content).toContain('<lastmod>2026-08-01T09:00:00.000Z</lastmod>')
  })

  it('flags missing robots.txt Sitemap directive', () => {
    const result = generateSitemap(mockInput([page('https://autodun.com/', 'INDEXABLE')]))
    expect(result.robotsTxtHasSitemap).toBe(false)
    expect(result.robotsTxtSitemapDirective).toBe('Sitemap: https://autodun.com/sitemap.xml')
    expect(result.checks.some((c) => c.id === 'robots-missing-sitemap')).toBe(true)
  })

  it('flags orphaned-in-sitemap URLs from coverage', () => {
    const result = generateSitemap(mockInput([page('https://autodun.com/', 'INDEXABLE')]))
    const orphan = result.checks.find((c) => c.id === 'orphaned-in-sitemap')
    expect(orphan?.urls).toContain('https://autodun.com/old-page.html')
  })

  it('produces valid xml declaration and namespace', () => {
    const xml = buildUrlsetXml([{ loc: 'https://example.com/', crawledUrl: 'https://example.com/' }])
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/)
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
  })

  it('splits into index + parts when url count exceeds per-file limit', () => {
    const entries = Array.from({ length: 3 }, (_, i) => ({
      loc: `https://example.com/p-${i}`,
      crawledUrl: `https://example.com/p-${i}`,
    }))
    const files = buildSitemapFiles(entries, 'https://example.com', { maxUrlsPerFile: 2 })
    expect(files.some((f) => f.filename === 'sitemap-index.xml')).toBe(true)
    expect(files.filter((f) => f.filename.match(/^sitemap-\d+\.xml$/)).length).toBe(2)
  })
})

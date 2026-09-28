import { describe, expect, it } from 'vitest'
import { generateSitemap } from './generate'
import type { SitemapCrawlInput } from './types'
import type { PageIndexability } from '@/lib/index-diagnosis/types'

/**
 * Autodun preferred-form scenario — offline fixture.
 *
 * Why not live-by-default: the previous live crawl in CI failed repeatedly when
 * `/blog/index.html` correctly returned AT_RISK (canonical → `/blog`). That
 * made every PR look red for a "known flake" and trained merges past CI.
 *
 * Tracking note: docs/fix-strategies/ISSUE_LIVE_AUTODUN_SITEMAP_TEST.md
 */

function page(
  url: string,
  verdict: PageIndexability['verdict'],
): PageIndexability {
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
  }
}

function fixtureInput(pages: PageIndexability[]): SitemapCrawlInput {
  return {
    domain: 'autodun.com',
    seedUrl: 'https://autodun.com/',
    pages,
    coverage: {
      domain: 'autodun.com',
      seedUrl: 'https://autodun.com/',
      discoveredCount: pages.length,
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
      discoverySources: { sitemap: 0, links: 1, both: 0, seed: 1 },
      sitemapOnlyUrls: [],
      linkedOnlyUrls: [],
      sitemapDiscoveredUrls: pages.map((p) => p.url),
      robotsTxtFetched: true,
      robotsTxtEvidence: 'ok',
    },
    robotsTxt: 'User-agent: *\nDisallow:',
    ranAt: '2026-09-28T00:00:00.000Z',
    crawlSource: 'fresh',
  }
}

describe('autodun.com sitemap canonical dedupe (fixture)', () => {
  it('includes /blog but not /blog/index.html when index.html is AT_RISK peer', () => {
    const pages = [
      page('https://autodun.com/', 'INDEXABLE'),
      page('https://autodun.com/blog', 'INDEXABLE'),
      page('https://autodun.com/blog/index.html', 'AT_RISK'),
    ]

    const sitemap = generateSitemap(fixtureInput(pages))

    const xml = sitemap.files.find((f) => f.filename === 'sitemap.xml')!.content
    expect(xml).toMatch(/<loc>https:\/\/autodun\.com\/blog<\/loc>/)
    expect(xml).not.toContain('blog/index.html')
  })
})

const live = process.env.LIVE_CRAWL === '1'

describe.skipIf(!live)('autodun.com sitemap canonical dedupe (live)', () => {
  it('blog INDEXABLE; index.html AT_RISK or absent; sitemap omits index.html', async () => {
    const { runIndexDiagnosis } = await import('@/lib/index-diagnosis/run')
    const diagnosis = await runIndexDiagnosis('https://autodun.com/')
    const blog = diagnosis.pages.find((p) => p.url === 'https://autodun.com/blog')
    const indexHtml = diagnosis.pages.find(
      (p) => p.url === 'https://autodun.com/blog/index.html',
    )
    expect(blog?.verdict).toBe('INDEXABLE')
    if (indexHtml) {
      expect(indexHtml.verdict).toBe('AT_RISK')
    }

    const sitemap = generateSitemap({
      domain: diagnosis.coverage.domain,
      seedUrl: diagnosis.coverage.seedUrl,
      pages: diagnosis.pages,
      coverage: diagnosis.coverage,
      htmlByUrl: diagnosis.htmlByUrl,
      robotsTxt: diagnosis.robotsTxt || '',
      ranAt: diagnosis.ranAt,
      crawlSource: 'fresh',
    })

    const xml = sitemap.files.find((f) => f.filename === 'sitemap.xml')!.content
    expect(xml).toMatch(/<loc>https:\/\/autodun\.com\/blog<\/loc>/)
    expect(xml).not.toContain('blog/index.html')
  }, 60_000)
})

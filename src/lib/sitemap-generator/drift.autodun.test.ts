/**
 * Live integration check against autodun.com deployed sitemap.
 * Run: npx vitest run src/lib/sitemap-generator/drift.autodun.test.ts
 */
import { describe, expect, it } from 'vitest'
import { detectSitemapDrift } from './drift'
import type { SitemapCrawlInput } from './types'
import type { PageIndexability } from '@/lib/index-diagnosis/types'

function autodunInput(pages: PageIndexability[]): SitemapCrawlInput {
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
      discoverySources: { sitemap: 5, links: 10, both: 0, seed: 1 },
      sitemapOnlyUrls: [],
      linkedOnlyUrls: [],
      sitemapDiscoveredUrls: [],
      robotsTxtFetched: true,
      robotsTxtEvidence: 'ok',
    },
    robotsTxt: 'User-agent: *\nDisallow:',
    ranAt: new Date().toISOString(),
    crawlSource: 'fresh',
  }
}

function indexablePage(url: string): PageIndexability {
  return {
    url,
    verdict: 'INDEXABLE',
    decisiveStep: null,
    decisiveEvidence: 'ok',
    steps: [
      { step: 'http_status', passed: true, evidence: 'HTTP 200' },
      { step: 'meta_robots', passed: true, evidence: 'No meta robots tag' },
      { step: 'x_robots', passed: true, evidence: 'No X-Robots-Tag header' },
    ],
    httpStatus: 200,
    crawlDepth: 1,
    internalLinksIn: 1,
    inboundLinks: [],
    duplicateClusterId: null,
    duplicateClusterSize: 1,
    mainContentFingerprint: 'fp',
    pathPattern: '/',
    depthBand: '1',
    pageTitle: 'Page',
    pageH1: 'H1',
  }
}

describe('autodun.com live deployed sitemap', () => {
  it(
    'all live sitemap URLs return HTTP 200 and no noindex contradictions among crawled pages',
    async () => {
      const drift = await detectSitemapDrift(
        autodunInput([indexablePage('https://autodun.com/')]),
      )

      expect(drift.liveSitemapFetched).toBe(true)
      expect(drift.liveUrlCount).toBeGreaterThan(0)
      expect(drift.liveHealthChecked).toBe(true)
      expect(drift.liveHealthFailures).toEqual([])
      expect(drift.liveHealthResults.length).toBe(drift.liveUrlCount)
      expect(drift.liveHealthResults.every((r) => r.ok && r.httpStatus === 200)).toBe(true)
      expect(drift.noindexContradictions).toEqual([])
    },
    120_000,
  )
})

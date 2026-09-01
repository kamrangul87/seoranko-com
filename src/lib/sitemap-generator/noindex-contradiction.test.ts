import { describe, expect, it } from 'vitest'
import { findNoindexInSitemapContradictions } from './noindex-contradiction'
import type { CrawlCoverage, PageIndexability } from '@/lib/index-diagnosis/types'

function baseCoverage(overrides: Partial<CrawlCoverage> = {}): CrawlCoverage {
  return {
    domain: 'autodun.com',
    seedUrl: 'https://autodun.com/',
    discoveredCount: 5,
    fetchedCount: 5,
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
    discoverySources: { sitemap: 1, links: 4, both: 0, seed: 1 },
    sitemapOnlyUrls: [],
    linkedOnlyUrls: [],
    sitemapDiscoveredUrls: [],
    robotsTxtFetched: true,
    robotsTxtEvidence: 'ok',
    ...overrides,
  }
}

function pageWithNoindex(url: string, source: 'meta' | 'x'): PageIndexability {
  return {
    url,
    verdict: 'BLOCKED',
    decisiveStep: source === 'meta' ? 'meta_robots' : 'x_robots',
    decisiveEvidence: 'noindex',
    steps: [
      { step: 'http_status', passed: true, evidence: 'HTTP 200' },
      {
        step: 'meta_robots',
        passed: source !== 'meta',
        evidence:
          source === 'meta'
            ? '<meta name="robots" content="noindex, follow">'
            : 'No meta robots tag',
      },
      {
        step: 'x_robots',
        passed: source !== 'x',
        evidence: source === 'x' ? 'X-Robots-Tag: noindex' : 'No X-Robots-Tag header',
      },
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
    pageTitle: 'T',
    pageH1: 'H',
  }
}

describe('findNoindexInSitemapContradictions', () => {
  it('flags meta noindex pages listed in live sitemap', () => {
    const url = 'https://autodun.com/thank-you'
    const hits = findNoindexInSitemapContradictions(
      [url],
      [pageWithNoindex(url, 'meta')],
      baseCoverage(),
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]!.source).toBe('meta_robots')
    expect(hits[0]!.fixGuidance).toContain('remove the URL from sitemap')
    expect(hits[0]!.fixGuidance).toContain('remove the noindex directive')
  })

  it('flags X-Robots noindex from excluded crawl records', () => {
    const url = 'https://autodun.com/private'
    const coverage = baseCoverage({
      excluded: [{ url, reason: 'X_ROBOTS_NOINDEX', evidence: 'X-Robots-Tag: noindex' }],
    })
    const hits = findNoindexInSitemapContradictions([url], [], coverage)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.source).toBe('x_robots')
  })

  it('returns empty when live sitemap URLs are indexable', () => {
    const url = 'https://autodun.com/about'
    const page: PageIndexability = {
      ...pageWithNoindex(url, 'meta'),
      verdict: 'INDEXABLE',
      steps: pageWithNoindex(url, 'meta').steps.map((s) =>
        s.step === 'meta_robots' ? { ...s, passed: true } : s,
      ),
    }
    const hits = findNoindexInSitemapContradictions([url], [page], baseCoverage())
    expect(hits).toHaveLength(0)
  })
})

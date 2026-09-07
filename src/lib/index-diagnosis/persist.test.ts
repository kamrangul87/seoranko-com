import { describe, expect, it } from 'vitest'
import {
  reconstructIndexDiagnosisFromRow,
  type IndexDiagnosisRunRow,
} from './persist'
import type { CrawlCoverage, PageIndexability } from './types'

function emptyCoverage(domain = 'example.com'): CrawlCoverage {
  return {
    domain,
    seedUrl: `https://${domain}/`,
    discoveredCount: 2,
    fetchedCount: 1,
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
    sitemapDiscoveredUrls: [],
    robotsTxtFetched: true,
    robotsTxtEvidence: 'ok',
  }
}

function page(url: string): PageIndexability {
  return {
    url,
    verdict: 'INDEXABLE',
    decisiveStep: null,
    decisiveEvidence: '',
    steps: [
      {
        step: 'http_status',
        passed: true,
        evidence: '200',
      },
    ],
    httpStatus: 200,
    crawlDepth: 0,
    internalLinksIn: 1,
    inboundLinks: [{ fromUrl: 'https://example.com/', fromDepth: 0 }],
    duplicateClusterId: null,
    duplicateClusterSize: 1,
    mainContentFingerprint: 'fp',
    pathPattern: '/',
    depthBand: '0',
    pageTitle: 'Home',
    pageH1: 'Home',
  }
}

describe('reconstructIndexDiagnosisFromRow', () => {
  it('rebuilds a displayable IndexDiagnosisResult from a persisted DB row without re-crawl', () => {
    const row: IndexDiagnosisRunRow = {
      id: 'run-1',
      domain: 'example.com',
      seed_url: 'https://example.com/',
      verdict_headline: 'Most pages look indexable',
      coverage: emptyCoverage(),
      pages: [page('https://example.com/')],
      cohorts: [],
      top_causes: [
        {
          cause: 'thin',
          affectedUrlCount: 1,
          exampleUrl: 'https://example.com/',
          exampleEvidence: 'demo',
        },
      ],
      indexable_count: 1,
      blocked_count: 0,
      at_risk_count: 0,
      created_at: '2026-09-07T12:00:00.000Z',
    }

    const result = reconstructIndexDiagnosisFromRow(row)

    expect(result.verdict.headline).toBe('Most pages look indexable')
    expect(result.verdict.indexableCount).toBe(1)
    expect(result.pages).toHaveLength(1)
    expect(result.ranAt).toBe('2026-09-07T12:00:00.000Z')
    expect(result.crawlerJsLimitation).toBe(true)
    expect(result.htmlByUrl).toBeUndefined()
    expect(result.inboundLinksByUrl?.['https://example.com/']).toEqual([
      { fromUrl: 'https://example.com/', fromDepth: 0 },
    ])
    expect(Array.isArray(result.followUpTasks)).toBe(true)
  })
})

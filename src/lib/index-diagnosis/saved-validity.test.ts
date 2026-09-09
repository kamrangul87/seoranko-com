import { describe, expect, it } from 'vitest'
import {
  isUsableIndexDiagnosis,
  isUsablePageAuditSnapshot,
  savedAuditNeedsFreshCrawl,
} from './saved-validity'
import type { IndexDiagnosisResult } from './types'

function baseResult(over: Partial<IndexDiagnosisResult> = {}): IndexDiagnosisResult {
  return {
    coverage: {
      domain: 'example.com',
      seedUrl: 'https://example.com/',
      discoveredCount: 1,
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
      terminationEvidence: 'ok',
      discoverySources: { sitemap: 0, links: 0, both: 0, seed: 1 },
      sitemapOnlyUrls: [],
      linkedOnlyUrls: [],
      sitemapDiscoveredUrls: [],
      robotsTxtFetched: true,
      robotsTxtEvidence: 'ok',
    },
    pages: [
      {
        url: 'https://example.com/',
        verdict: 'INDEXABLE',
        decisiveStep: null,
        decisiveEvidence: '',
        steps: [],
        httpStatus: 200,
        crawlDepth: 0,
        internalLinksIn: 0,
        inboundLinks: [],
        duplicateClusterId: null,
        duplicateClusterSize: 1,
        mainContentFingerprint: 'x',
        pathPattern: '/',
        depthBand: '0',
        pageTitle: 'Home',
        pageH1: 'Home',
      },
    ],
    cohorts: [],
    verdict: {
      headline: 'ok',
      topCauses: [],
      indexableCount: 1,
      blockedCount: 0,
      atRiskCount: 0,
    },
    followUpTasks: [],
    ...over,
  } as IndexDiagnosisResult
}

describe('saved Index Diagnosis / page-audit validity', () => {
  it('rejects empty diagnosis (the Audit-page zero-score restore bug)', () => {
    expect(
      isUsableIndexDiagnosis(
        baseResult({
          pages: [],
          coverage: { ...baseResult().coverage, fetchedCount: 0, discoveredCount: 0 },
        }),
      ),
    ).toBe(false)
  })

  it('accepts a real crawled diagnosis', () => {
    expect(isUsableIndexDiagnosis(baseResult())).toBe(true)
  })

  it('rejects zeroed Quality Gate stubs', () => {
    expect(
      isUsablePageAuditSnapshot({
        score: 0,
        httpStatus: 0,
        wordCount: 0,
        issues: [],
      }),
    ).toBe(false)
  })

  it('accepts a real Quality Gate row', () => {
    expect(
      isUsablePageAuditSnapshot({
        score: 61,
        httpStatus: 200,
        wordCount: 12,
        issues: [],
      }),
    ).toBe(true)
  })

  it('needsFreshCrawl when either side is missing', () => {
    expect(
      savedAuditNeedsFreshCrawl({ diagnosis: baseResult(), pageAudit: null }).needsFreshCrawl,
    ).toBe(true)
    expect(
      savedAuditNeedsFreshCrawl({
        diagnosis: null,
        pageAudit: { score: 50, httpStatus: 200, wordCount: 100, issues: [] },
      }).needsFreshCrawl,
    ).toBe(true)
    expect(
      savedAuditNeedsFreshCrawl({
        diagnosis: baseResult(),
        pageAudit: { score: 50, httpStatus: 200, wordCount: 100, issues: [] },
      }).needsFreshCrawl,
    ).toBe(false)
  })
})

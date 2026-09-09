/**
 * Regression: stale Link Graph must not be restored when diagnosis needs a fresh crawl.
 */

import { describe, expect, it } from 'vitest'
import { buildSavedAuditPayload } from './audit-saved-payload'
import type { IndexDiagnosisRunRow } from './index-diagnosis/persist'
import type { IndexDiagnosisResult } from './index-diagnosis/types'

function emptyDiagnosis(): IndexDiagnosisResult {
  return {
    coverage: {
      domain: 'example.com',
      seedUrl: 'https://example.com/',
      discoveredCount: 0,
      fetchedCount: 0,
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
      terminationEvidence: 'empty',
      discoverySources: { sitemap: 0, links: 0, both: 0, seed: 0 },
      sitemapOnlyUrls: [],
      linkedOnlyUrls: [],
      sitemapDiscoveredUrls: [],
      robotsTxtFetched: false,
      robotsTxtEvidence: '',
    },
    pages: [],
    cohorts: [],
    verdict: {
      headline: 'empty',
      topCauses: [],
      indexableCount: 0,
      blockedCount: 0,
      atRiskCount: 0,
    },
    followUpTasks: [],
  } as IndexDiagnosisResult
}

describe('stale Link Graph after invalid diagnosis', () => {
  it('omits linkGraph when needsFreshCrawl is true', () => {
    const row = {
      id: 'run-1',
      domain: 'example.com',
      seed_url: 'https://example.com/',
      verdict_headline: 'empty',
      coverage: emptyDiagnosis().coverage,
      pages: [],
      cohorts: [],
      top_causes: [],
      indexable_count: 0,
      blocked_count: 0,
      at_risk_count: 0,
      created_at: '2026-01-01T00:00:00Z',
    } satisfies IndexDiagnosisRunRow

    const payload = buildSavedAuditPayload({
      domain: 'example.com',
      diagnosis: { row, result: emptyDiagnosis() },
      pageAudit: {
        url: 'https://example.com/',
        score: 0,
        httpStatus: 0,
        wordCount: 0,
        title: '',
        h1: '',
        metaDescription: '',
        hasSchema: false,
        issues: [],
        opportunities: [],
        explainable: {
          dimensions: [],
          score: 0,
          totalPossible: 100,
          confidence: 'low',
        } as never,
        lastAuditedAt: null,
      },
      linkGraph: {
        audit: {
          id: 'lg-1',
          created_at: '2026-01-01T00:00:00Z',
          verdict_headline: 'stale',
          top_causes: [],
          js_suspected: false,
          trailing_slash_convention: false,
        },
        findingCount: 3,
        criticalCount: 1,
        failCount: 1,
        warnCount: 1,
        topFindings: [{ id: 'L01' }],
      },
      tablesMissing: false,
    })

    expect(payload.needsFreshCrawl).toBe(true)
    expect(payload.linkGraph).toBeNull()
    expect(payload.indexDiagnosis).toBeNull()
  })
})

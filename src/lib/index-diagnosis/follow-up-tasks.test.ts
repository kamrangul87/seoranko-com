import { describe, expect, it } from 'vitest'
import { buildSiteFollowUpTasks } from './follow-up-tasks'
import type { IndexDiagnosisResult } from './types'

function minimalResult(overrides: Partial<IndexDiagnosisResult>): IndexDiagnosisResult {
  return {
    coverage: {
      domain: 'example.com',
      seedUrl: 'https://example.com/',
      discoveredCount: 10,
      fetchedCount: 8,
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
      discoverySources: { sitemap: 0, links: 0, both: 0, seed: 1 },
      sitemapOnlyUrls: [],
      sitemapDiscoveredUrls: [],
      linkedOnlyUrls: [],
      sitemapDiscoveredUrls: [],
      robotsTxtFetched: true,
      robotsTxtEvidence: 'ok',
    },
    pages: [],
    cohorts: [],
    verdict: {
      headline: 'test',
      topCauses: [],
      indexableCount: 0,
      blockedCount: 0,
      atRiskCount: 0,
    },
    followUpTasks: [],
    ranAt: '',
    ...overrides,
  }
}

describe('buildSiteFollowUpTasks', () => {
  it('flags non-200 excluded URLs', () => {
    const tasks = buildSiteFollowUpTasks(
      minimalResult({
        coverage: {
          ...minimalResult({}).coverage,
          excluded: [
            { url: 'https://example.com/broken', reason: 'NON_200', evidence: 'HTTP 404', httpStatus: 404 },
          ],
          excludedByReason: { ...minimalResult({}).coverage.excludedByReason, NON_200: 1 },
        },
      }),
    )
    expect(tasks.some((t) => t.id === 'non-200-linked-urls')).toBe(true)
    expect(tasks.find((t) => t.id === 'non-200-linked-urls')?.affectedUrls).toContain('https://example.com/broken')
  })

  it('flags linked-only sitemap gaps', () => {
    const tasks = buildSiteFollowUpTasks(
      minimalResult({
        coverage: {
          ...minimalResult({}).coverage,
          linkedOnlyUrls: ['https://example.com/missing-from-sitemap'],
        },
      }),
    )
    expect(tasks.some((t) => t.id === 'sitemap-missing-linked-urls')).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { detectCrawledNotIndexed } from './detect'
import type { GscDetectContext } from '@/lib/fix-strategies/shared/gsc-detect-context'

function ctx(inspections: GscDetectContext['inspections']): GscDetectContext {
  return {
    siteId: 's1',
    propertyUrl: 'sc-domain:example.com',
    connectionStatus: 'active',
    inspections,
    inspectionsByUrl: new Map(inspections.map((i) => [i.urlNormalized, i])),
    metrics: [],
    metricsByUrl: new Map(),
    inspectionCoveragePartial: true,
    inspectionRowCount: inspections.length,
  }
}

describe('topic 57 crawled not indexed', () => {
  it('is silent without GSC', () => {
    expect(detectCrawledNotIndexed({ gsc: null }).findings).toHaveLength(0)
  })

  it('reports Google definition and never infers thin/quality', () => {
    const r = detectCrawledNotIndexed({
      gsc: ctx([
        {
          url: 'https://example.com/x',
          urlNormalized: 'https://example.com/x',
          coverageState: 'Crawled - currently not indexed',
          indexingState: 'INDEXING_ALLOWED',
          googleCanonical: 'https://example.com/x',
          userCanonical: 'https://example.com/x',
          canonicalMismatch: false,
          lastCrawlTime: '2026-09-09T15:02:37Z',
          inspectedAt: '2026-09-20T00:00:00Z',
        },
      ]),
      independentFindingsByUrl: new Map([
        ['https://example.com/x', ['topic-16: html/header disagree']],
      ]),
    })
    expect(r.findings).toHaveLength(1)
    const f = r.findings[0]!
    expect(f.detail).toMatch(/does not publish why/i)
    // Refusal language may name the forbidden inferences; must not assert them as cause.
    expect(f.detail).toMatch(/does not translate that state into/i)
    expect(f.evidenceValues.neverInferThinOrDuplicateOrQuality).toBe(true)
    expect(f.evidenceValues.noPublishedClassifier).toBe(true)
    expect(f.evidenceValues.independentFindings).toEqual([
      'topic-16: html/header disagree',
    ])
    expect(f.detail).toMatch(/Separately, independent findings/)
  })
})

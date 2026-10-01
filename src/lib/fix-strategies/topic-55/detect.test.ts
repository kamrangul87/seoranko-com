import { describe, expect, it } from 'vitest'
import { detectGoogleChosenCanonicalMismatch } from './detect'
import type { GscDetectContext } from '@/lib/fix-strategies/shared/gsc-detect-context'

function ctx(inspections: GscDetectContext['inspections']): GscDetectContext {
  const map = new Map(inspections.map((i) => [i.urlNormalized, i]))
  return {
    siteId: 's1',
    propertyUrl: 'sc-domain:example.com',
    connectionStatus: 'active',
    inspections,
    inspectionsByUrl: map,
    metrics: [],
    metricsByUrl: new Map(),
    inspectionCoveragePartial: true,
    inspectionRowCount: inspections.length,
  }
}

describe('topic 55 google-chosen canonical', () => {
  it('is silent without GSC', () => {
    const r = detectGoogleChosenCanonicalMismatch({ gsc: null })
    expect(r.findings).toHaveLength(0)
  })

  it('never raises Alternate page with proper canonical', () => {
    const r = detectGoogleChosenCanonicalMismatch({
      gsc: ctx([
        {
          url: 'https://example.com/a',
          urlNormalized: 'https://example.com/a',
          coverageState: 'Alternate page with proper canonical',
          indexingState: null,
          googleCanonical: 'https://example.com/b',
          userCanonical: 'https://example.com/a',
          canonicalMismatch: true,
          lastCrawlTime: '2026-01-01',
          inspectedAt: '2026-01-02',
        },
      ]),
    })
    expect(r.findings).toHaveLength(0)
    expect(r.suppressed[0]?.reason).toBe('alternate_page_with_proper_canonical')
  })

  it('raises when google and user canonicals differ after normalize', () => {
    const r = detectGoogleChosenCanonicalMismatch({
      gsc: ctx([
        {
          url: 'https://example.com/page',
          urlNormalized: 'https://example.com/page',
          coverageState: 'Submitted and indexed',
          indexingState: 'INDEXING_ALLOWED',
          googleCanonical: 'https://example.com/page',
          userCanonical: 'https://www.example.com/page',
          canonicalMismatch: true,
          lastCrawlTime: '2026-06-08T11:52:40Z',
          inspectedAt: '2026-09-01T00:00:00Z',
        },
      ]),
    })
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]!.verdict).toBe('google-chose-different-canonical')
    expect(r.findings[0]!.evidenceValues.historical).toBe(true)
    expect(r.findings[0]!.autoFixable).toBe(false)
  })

  it('does not treat trailing-slash difference as noise — it is a real mismatch', () => {
    const r = detectGoogleChosenCanonicalMismatch({
      gsc: ctx([
        {
          url: 'https://example.com/page',
          urlNormalized: 'https://example.com/page',
          coverageState: 'Submitted and indexed',
          indexingState: null,
          googleCanonical: 'https://example.com/page/',
          userCanonical: 'https://example.com/page',
          canonicalMismatch: true,
          lastCrawlTime: null,
          inspectedAt: null,
        },
      ]),
    })
    expect(r.findings).toHaveLength(1)
  })
})

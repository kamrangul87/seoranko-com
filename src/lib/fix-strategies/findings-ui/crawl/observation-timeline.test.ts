import { describe, expect, it, beforeEach } from 'vitest'
import {
  classifyUrlObservationPattern,
  createMemoryFindingsStore,
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
  type UrlObservationPoint,
} from './index'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

const windowMs = FIX_STRATEGY_PRODUCT_DECISIONS.persistent5xxObservationWindowMs

function pts(
  ...rows: Array<{ status: number | null; at: number }>
): UrlObservationPoint[] {
  return rows.map((r) => ({ httpStatus: r.status, observedAtMs: r.at }))
}

describe('classifyUrlObservationPattern', () => {
  it('never labels persistent from a single observation', () => {
    expect(classifyUrlObservationPattern(pts({ status: 503, at: 0 }))).toBe(
      'insufficient',
    )
  })

  it('returns insufficient for empty or all-ok series', () => {
    expect(classifyUrlObservationPattern([])).toBe('insufficient')
    expect(
      classifyUrlObservationPattern(
        pts({ status: 200, at: 0 }, { status: 200, at: 1_000 }),
      ),
    ).toBe('insufficient')
  })

  it('labels historical_resolved when earlier error is ok now', () => {
    expect(
      classifyUrlObservationPattern(
        pts({ status: 503, at: 0 }, { status: 200, at: 60_000 }),
      ),
    ).toBe('historical_resolved')
  })

  it('labels intermittent when ok and error alternate and ends in error', () => {
    expect(
      classifyUrlObservationPattern(
        pts(
          { status: 200, at: 0 },
          { status: 503, at: 60_000 },
          { status: 200, at: 120_000 },
          { status: 503, at: 180_000 },
        ),
      ),
    ).toBe('intermittent')
  })

  it('labels transient for multi-error streak that does not span the window', () => {
    expect(
      classifyUrlObservationPattern(
        pts({ status: 503, at: 0 }, { status: 503, at: 60_000 }),
      ),
    ).toBe('transient')
  })

  it('labels persistent only when 5xx streak spans the product window', () => {
    expect(
      classifyUrlObservationPattern(
        pts(
          { status: 503, at: 0 },
          { status: 503, at: windowMs },
        ),
      ),
    ).toBe('persistent')
  })

  it('treats 4xx-only multi-error streak as transient (not persistent)', () => {
    expect(
      classifyUrlObservationPattern(
        pts(
          { status: 404, at: 0 },
          { status: 404, at: windowMs },
        ),
      ),
    ).toBe('transient')
  })

  it('treats null status as error for classification', () => {
    expect(
      classifyUrlObservationPattern(
        pts({ status: null, at: 0 }, { status: 200, at: 1 }),
      ),
    ).toBe('historical_resolved')
  })
})

describe('url observation store (memory)', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
  })

  it('upserts one observation per (run, url) and lists oldest→newest', async () => {
    const store = createMemoryFindingsStore()
    const run1 = await store.createRun({
      siteId: 'site-obs',
      userId: 'u',
      origin: 'https://example.com',
    })
    const run2 = await store.createRun({
      siteId: 'site-obs',
      userId: 'u',
      origin: 'https://example.com',
    })

    await store.appendUrlObservation({
      runId: run1.id,
      siteId: 'site-obs',
      userId: 'u',
      url: 'https://example.com/x',
      finalUrl: 'https://example.com/x',
      httpStatus: 503,
      redirectHops: [],
      retryAfter: null,
      durationMs: 12,
      observedAt: '2026-09-26T00:00:00.000Z',
    })
    await store.appendUrlObservation({
      runId: run1.id,
      siteId: 'site-obs',
      userId: 'u',
      url: 'https://example.com/x',
      finalUrl: 'https://example.com/x',
      httpStatus: 502,
      redirectHops: [],
      retryAfter: null,
      durationMs: 15,
      observedAt: '2026-09-26T00:00:01.000Z',
    })
    await store.appendUrlObservation({
      runId: run2.id,
      siteId: 'site-obs',
      userId: 'u',
      url: 'https://example.com/x',
      finalUrl: 'https://example.com/x',
      httpStatus: 200,
      redirectHops: [],
      retryAfter: null,
      durationMs: 20,
      observedAt: '2026-09-28T00:00:00.000Z',
    })

    const series = await store.listUrlObservations({
      siteId: 'site-obs',
      url: 'https://example.com/x',
    })
    expect(series).toHaveLength(2)
    expect(series.map((o) => o.httpStatus)).toEqual([502, 200])
    expect(series.map((o) => o.runId)).toEqual([run1.id, run2.id])

    const pattern = classifyUrlObservationPattern(
      series.map((o) => ({
        httpStatus: o.httpStatus,
        observedAtMs: Date.parse(o.observedAt),
      })),
    )
    expect(pattern).toBe('historical_resolved')
  })

  it('scopes listUrlObservations by siteId and never mixes detect-origin rows', async () => {
    const store = createMemoryFindingsStore()
    const runSite = await store.createRun({
      siteId: 'site-a',
      userId: 'u',
      origin: 'https://a.example.com',
    })
    const runDetect = await store.createRun({
      siteId: null,
      userId: 'u',
      origin: 'https://b.example.com',
      detectOnly: true,
    })

    await store.appendUrlObservation({
      runId: runSite.id,
      siteId: 'site-a',
      userId: 'u',
      url: 'https://a.example.com/',
      finalUrl: 'https://a.example.com/',
      httpStatus: 200,
      redirectHops: [],
      retryAfter: null,
      durationMs: 1,
    })
    await store.appendUrlObservation({
      runId: runDetect.id,
      siteId: null,
      detectOrigin: runDetect.detectOrigin,
      userId: 'u',
      url: 'https://a.example.com/',
      finalUrl: 'https://a.example.com/',
      httpStatus: 503,
      redirectHops: [],
      retryAfter: null,
      durationMs: 1,
    })

    const bySite = await store.listUrlObservations({
      siteId: 'site-a',
      url: 'https://a.example.com/',
    })
    expect(bySite).toHaveLength(1)
    expect(bySite[0]!.httpStatus).toBe(200)

    const byDetect = await store.listUrlObservations({
      detectOrigin: 'https://b.example.com',
      userId: 'u',
      url: 'https://a.example.com/',
    })
    expect(byDetect).toHaveLength(1)
    expect(byDetect[0]!.httpStatus).toBe(503)
  })
})

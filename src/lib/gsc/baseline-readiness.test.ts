import { describe, expect, it } from 'vitest'
import {
  evaluateBaselineReadiness,
  type DailyUrlMetric,
} from './baseline-readiness'
import {
  gscAvailableEndDate,
  gscBackfillDateRange,
  gscFinalityCutoffDate,
  isGscDateFinal,
} from './client'

function row(
  url: string,
  date: string,
  impressions: number,
  opts?: Partial<DailyUrlMetric>,
): DailyUrlMetric {
  return {
    url,
    date,
    impressions,
    clicks: Math.floor(impressions / 10),
    avg_position: 12,
    is_final: true,
    ...opts,
  }
}

function buildFlatBaseline(opts: {
  urls: number
  days: number
  start: string
  dailyImpressionsPerUrl?: number
}): DailyUrlMetric[] {
  const rows: DailyUrlMetric[] = []
  const start = new Date(`${opts.start}T00:00:00.000Z`)
  for (let d = 0; d < opts.days; d++) {
    const day = new Date(start)
    day.setUTCDate(start.getUTCDate() + d)
    const date = day.toISOString().slice(0, 10)
    for (let u = 0; u < opts.urls; u++) {
      rows.push(row(`https://example.com/page-${u}`, date, opts.dailyImpressionsPerUrl ?? 20))
    }
  }
  return rows
}

describe('GSC finality helpers', () => {
  it('marks the last 3 days as provisional', () => {
    const now = new Date('2026-09-07T12:00:00.000Z')
    expect(gscFinalityCutoffDate(now)).toBe('2026-09-04')
    expect(isGscDateFinal('2026-09-04', now)).toBe(true)
    expect(isGscDateFinal('2026-09-05', now)).toBe(false)
    expect(gscAvailableEndDate(now)).toBe('2026-09-06')
  })

  it('backfill range spans ~16 months ending at available end', () => {
    const now = new Date('2026-09-07T12:00:00.000Z')
    const range = gscBackfillDateRange(now)
    expect(range.endDate).toBe('2026-09-06')
    expect(range.startDate < range.endDate).toBe(true)
    const start = new Date(`${range.startDate}T00:00:00.000Z`)
    const end = new Date(`${range.endDate}T00:00:00.000Z`)
    const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth())
    expect(months).toBeGreaterThanOrEqual(15)
    expect(months).toBeLessThanOrEqual(17)
  })
})

describe('evaluateBaselineReadiness', () => {
  it('passes a clean 60-day / 40-URL baseline', () => {
    const rows = buildFlatBaseline({ urls: 40, days: 60, start: '2026-06-01' })
    const result = evaluateBaselineReadiness(rows)
    expect(result.passed).toBe(true)
    expect(result.reasonCode).toBe('ready')
    expect(result.evidence.urlCountWithImpressions).toBe(40)
    expect(result.evidence.usableDayCount).toBe(60)
  })

  it('fails when fewer than 30 URLs have impressions', () => {
    const rows = buildFlatBaseline({ urls: 10, days: 60, start: '2026-06-01' })
    const result = evaluateBaselineReadiness(rows)
    expect(result.passed).toBe(false)
    expect(result.reasonCode).toBe('insufficient_urls_with_impressions')
    expect(result.evidence.urlCountWithImpressions).toBe(10)
  })

  it('fails when usable days are under 56', () => {
    const rows = buildFlatBaseline({ urls: 40, days: 40, start: '2026-06-01' })
    const result = evaluateBaselineReadiness(rows)
    expect(result.passed).toBe(false)
    expect(result.reasonCode).toBe('insufficient_baseline_days')
    expect(result.evidence.usableDayCount).toBe(40)
  })

  it('fails when more than 40% of candidates have zero impressions', () => {
    const rows = buildFlatBaseline({ urls: 30, days: 60, start: '2026-06-01' })
    for (let u = 30; u < 60; u++) {
      for (let d = 0; d < 60; d++) {
        const day = new Date('2026-06-01T00:00:00.000Z')
        day.setUTCDate(day.getUTCDate() + d)
        rows.push(row(`https://example.com/zero-${u}`, day.toISOString().slice(0, 10), 0))
      }
    }
    const result = evaluateBaselineReadiness(rows)
    expect(result.passed).toBe(false)
    expect(result.reasonCode).toBe('too_many_zero_impression_urls')
    expect(result.evidence.zeroImpressionRatio).toBeGreaterThan(0.4)
  })

  it('fails on a site-wide drop that does not recover within 7 days', () => {
    const rows: DailyUrlMetric[] = []
    const start = new Date('2026-06-01T00:00:00.000Z')
    for (let d = 0; d < 60; d++) {
      const day = new Date(start)
      day.setUTCDate(start.getUTCDate() + d)
      const date = day.toISOString().slice(0, 10)
      // Day 20 collapses and stays down
      const impressions = d < 20 ? 100 : 20
      for (let u = 0; u < 35; u++) {
        rows.push(row(`https://example.com/p-${u}`, date, impressions))
      }
    }
    const result = evaluateBaselineReadiness(rows)
    expect(result.passed).toBe(false)
    expect(result.reasonCode).toBe('traffic_discontinuity')
    expect(result.evidence.discontinuity?.dropDate).toBeTruthy()
  })

  it('ignores provisional rows for readiness', () => {
    const rows = buildFlatBaseline({ urls: 40, days: 60, start: '2026-06-01' })
    // Add noisy provisional days that would otherwise look like a discontinuity
    rows.push(row('https://example.com/page-0', '2099-01-01', 1, { is_final: false }))
    const result = evaluateBaselineReadiness(rows)
    expect(result.passed).toBe(true)
    expect(result.evidence.usableDayCount).toBe(60)
  })

  it('requires positive min thresholds', () => {
    expect(() => evaluateBaselineReadiness([], { minUrlsRequired: 0 })).toThrow(/minUrlsRequired/)
  })
})

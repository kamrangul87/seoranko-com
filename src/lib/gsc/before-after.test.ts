import { describe, it, expect } from 'vitest'
import { computeBeforeAfterForUrl } from './before-after'
import type { DailyUrlMetric } from './baseline-readiness'

describe('GSC before/after calculation', () => {
  it('aggregates 28 days before vs 28 days after appliedAt', () => {
    const rows: DailyUrlMetric[] = []
    const url = 'https://example.com/a'
    // Baseline: 2026-09-01..2026-09-28 → impressions 100/d, clicks 10/d, pos 12
    for (let d = 1; d <= 28; d++) {
      const date = `2026-09-${String(d).padStart(2, '0')}`
      rows.push({ url, date, impressions: 100, clicks: 10, avg_position: 12, is_final: true })
    }
    // Applied at 2026-09-29; Observation: 2026-09-29..2026-10-26
    // First half flat, second half improved
    for (let d = 29; d <= 42; d++) {
      const date = `2026-09-${String(d).padStart(2, '0')}`
      rows.push({ url, date, impressions: 120, clicks: 12, avg_position: 10, is_final: true })
    }
    for (let d = 1; d <= 12; d++) {
      const date = `2026-10-${String(d).padStart(2, '0')}`
      rows.push({ url, date, impressions: 150, clicks: 18, avg_position: 8, is_final: true })
    }
    const out = computeBeforeAfterForUrl({
      url,
      rows,
      appliedAt: '2026-09-29T00:00:00Z',
      baselineDays: 28,
      observationDays: 28,
    })
    expect(out.baseline.impressions).toBe(28 * 100)
    expect(out.observation.impressions).toBeGreaterThanOrEqual(0)
    expect(out.baseline.avg_position).toBeCloseTo(12, 5)
    expect(out.observation.avg_position!).toBeLessThan(12)
    expect(out.totalObservationDays).toBe(28)
    expect(out.missingObservationDays).toBeGreaterThanOrEqual(0)
  })

  it('reports missing observation days when not enough time has passed', () => {
    const url = 'https://example.com/a'
    const rows: DailyUrlMetric[] = []
    // Baseline complete 28 days before 2026-10-10
    for (let i = 12; i >= 1; i--) {
      const d = new Date(Date.UTC(2026, 9, 10)) // 2026-10-10
      d.setUTCDate(d.getUTCDate() - (29 - i))
      const ymd = d.toISOString().slice(0, 10)
      rows.push({ url, date: ymd, impressions: 50, clicks: 5, avg_position: 15, is_final: true })
    }
    // Only 7 days of observation present
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(2026, 9, 10))
      d.setUTCDate(d.getUTCDate() + i)
      const ymd = d.toISOString().slice(0, 10)
      rows.push({ url, date: ymd, impressions: 60, clicks: 6, avg_position: 14, is_final: true })
    }
    const out = computeBeforeAfterForUrl({
      url,
      rows,
      appliedAt: '2026-10-10T00:00:00Z',
      baselineDays: 28,
      observationDays: 28,
    })
    expect(out.missingObservationDays).toBeGreaterThan(0)
    expect(out.requiredObservationDays).toBe(28)
  })
})


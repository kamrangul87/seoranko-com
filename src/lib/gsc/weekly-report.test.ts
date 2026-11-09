import { describe, expect, it } from 'vitest'
import type { QueryPageDaily } from './opportunities'
import {
  bestPage2NextAction,
  pickLatestCompleteWeek,
  weeklyTotalsFromRows,
} from './weekly-report'

function row(
  overrides: Partial<QueryPageDaily> & Pick<QueryPageDaily, 'date' | 'query' | 'url'>,
): QueryPageDaily {
  return {
    clicks: 0,
    impressions: 21,
    avg_position: 9.5,
    ctr: 0,
    is_final: true,
    ...overrides,
  }
}

describe('pickLatestCompleteWeek', () => {
  it('uses the latest finalized week with data, not yesterday with zeros', () => {
    const now = new Date('2026-11-09T12:00:00.000Z')
    const dates = []
    for (let d = 18; d <= 31; d++) dates.push(`2026-10-${d}`)
    for (let d = 1; d <= 5; d++) dates.push(`2026-11-0${d}`)
    const week = pickLatestCompleteWeek(dates, now)
    expect(week?.weekEnding).toBe('2026-11-05')
    expect(week?.startDate).toBe('2026-10-30')
    expect(week?.endDate).toBe('2026-11-05')
  })
})

describe('weeklyTotalsFromRows', () => {
  it('does not report a zero week ending after the last finalized date', () => {
    const now = new Date('2026-11-09T12:00:00.000Z')
    const rows: QueryPageDaily[] = []
    for (let d = 1; d <= 5; d++) {
      rows.push(
        row({
          date: `2026-11-0${d}`,
          url: 'https://autodun.com/blog/mot-history-check-uk.html',
          query: 'mot checker dvla',
          clicks: 2,
          impressions: 10,
        }),
      )
    }
    const out = weeklyTotalsFromRows(rows, now)
    expect(out?.week.weekEnding).toBe('2026-11-05')
    expect(out?.totals.clicks.current).toBeGreaterThan(0)
    expect(out?.totals.impressions.current).toBeGreaterThan(0)
  })
})

describe('bestPage2NextAction', () => {
  it('returns the same Page-2 row Google status would show', () => {
    const rows: QueryPageDaily[] = []
    for (let d = 18; d <= 31; d++) {
      rows.push(
        row({
          date: `2026-10-${d}`,
          url: 'https://autodun.com/blog/mot-history-check-uk.html',
          query: 'mot checker dvla',
          clicks: 0,
          impressions: 2,
          avg_position: 9.5,
        }),
      )
    }
    for (let d = 1; d <= 5; d++) {
      rows.push(
        row({
          date: `2026-11-0${d}`,
          url: 'https://autodun.com/blog/mot-history-check-uk.html',
          query: 'mot checker dvla',
          clicks: 0,
          impressions: 2,
          avg_position: 9.5,
        }),
      )
    }
    const next = bestPage2NextAction(rows)
    expect(next?.query).toBe('mot checker dvla')
    expect(next?.url).toContain('mot-history-check-uk')
    expect(next?.avg_position).toBeCloseTo(9.5, 1)
  })
})

import { describe, it, expect } from 'vitest'
import { aggregateWindowForQueryPage, pickWindowDates, type QueryPageDaily } from './opportunities'

describe('Page-2 opportunities scoring/filtering', () => {
  it('filters to avg position 8–20 and impressions above floor', () => {
    const rows: QueryPageDaily[] = [
      { url: 'https://e.com/a', query: 'q1', date: '2026-10-01', clicks: 10, impressions: 100, ctr: 0.1, avg_position: 9.0, is_final: true },
      { url: 'https://e.com/a', query: 'q1', date: '2026-10-02', clicks: 8, impressions: 80, ctr: 0.1, avg_position: 10.0, is_final: true },
      { url: 'https://e.com/b', query: 'q2', date: '2026-10-01', clicks: 1, impressions: 5, ctr: 0.2, avg_position: 12.0, is_final: true }, // below floor (default 10)
      { url: 'https://e.com/c', query: 'q3', date: '2026-10-01', clicks: 5, impressions: 100, ctr: 0.05, avg_position: 21.0, is_final: true }, // out of range
    ]
    const out = aggregateWindowForQueryPage(rows, '2026-10-01', '2026-10-31')
    expect(out.map((r) => r.query)).toEqual(['q1'])
    expect(out[0]!.avg_position).toBeCloseTo((9*100 + 10*80)/(100+80), 5)
  })

  it('scores by impressions × closeness to top 5', () => {
    const rows: QueryPageDaily[] = [
      { url: 'https://e.com/a', query: 'near-9', date: '2026-10-01', clicks: 10, impressions: 100, ctr: 0.1, avg_position: 9.0, is_final: true },
      { url: 'https://e.com/b', query: 'near-18', date: '2026-10-01', clicks: 5, impressions: 500, ctr: 0.01, avg_position: 18.0, is_final: true },
      { url: 'https://e.com/c', query: 'best', date: '2026-10-01', clicks: 20, impressions: 800, ctr: 0.025, avg_position: 8.0, is_final: true },
    ]
    const out = aggregateWindowForQueryPage(rows, '2026-10-01', '2026-10-31')
    // best at pos=8 with 800 impressions outranks others
    expect(out[0]!.query).toBe('best')
    expect(out[1]!.query).toBe('near-9')
    expect(out[2]!.query).toBe('near-18')
  })

  it('picks a 28d window when available, otherwise falls back to shorter/90', () => {
    const dates = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 1))
      d.setUTCDate(d.getUTCDate() + i)
      return d.toISOString().slice(0, 10)
    })
    const w = pickWindowDates(dates, 28, 90)
    expect(w!.windowDays).toBe(28)
    expect(w!.startDate).toBe(dates[2])
    expect(w!.endDate).toBe(dates[29])

    const short = pickWindowDates(dates.slice(0, 10), 28, 90)
    expect(short!.windowDays).toBe(10)
  })
})


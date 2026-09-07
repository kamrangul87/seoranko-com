import { describe, expect, it } from 'vitest'
import { buildDedupedUrlMetricsUpserts } from './dedupe-metrics'

describe('buildDedupedUrlMetricsUpserts', () => {
  it('merges www / trailing-slash / query variants that collide after normalizeUrl', () => {
    const { rows, collisions, inputCount, outputCount } = buildDedupedUrlMetricsUpserts(
      'site-1',
      [
        {
          page: 'https://www.autodun.com/blog/',
          date: '2026-08-01',
          clicks: 2,
          impressions: 100,
          ctr: 0.02,
          position: 10,
        },
        {
          page: 'https://autodun.com/blog',
          date: '2026-08-01',
          clicks: 3,
          impressions: 50,
          ctr: 0.06,
          position: 4,
        },
        {
          page: 'https://autodun.com/blog?utm=gsc',
          date: '2026-08-01',
          clicks: 1,
          impressions: 50,
          ctr: 0.02,
          position: 8,
        },
        {
          page: 'https://autodun.com/about',
          date: '2026-08-01',
          clicks: 1,
          impressions: 10,
          ctr: 0.1,
          position: 3,
        },
      ],
      '2026-09-07T00:00:00.000Z',
    )

    expect(inputCount).toBe(4)
    expect(outputCount).toBe(2)
    expect(collisions).toHaveLength(1)
    expect(collisions[0].url).toBe('https://autodun.com/blog')
    expect(collisions[0].date).toBe('2026-08-01')
    expect(collisions[0].rawPages).toEqual([
      'https://autodun.com/blog',
      'https://autodun.com/blog?utm=gsc',
      'https://www.autodun.com/blog/',
    ])
    expect(collisions[0].mergedClicks).toBe(6)
    expect(collisions[0].mergedImpressions).toBe(200)

    const blog = rows.find((r) => r.url === 'https://autodun.com/blog')!
    expect(blog.clicks).toBe(6)
    expect(blog.impressions).toBe(200)
    // impression-weighted position: (10*100 + 4*50 + 8*50) / 200 = 8
    expect(blog.avg_position).toBe(8)
    expect(blog.ctr).toBeCloseTo(0.03)
    expect(rows.map((r) => `${r.url}|${r.date}`).sort()).toEqual([
      'https://autodun.com/about|2026-08-01',
      'https://autodun.com/blog|2026-08-01',
    ])
  })

  it('produces unique (site_id,url,date) keys so a single INSERT cannot double-conflict', () => {
    const { rows } = buildDedupedUrlMetricsUpserts(
      'site-1',
      [
        { page: 'https://www.example.com/', date: '2026-01-01', clicks: 1, impressions: 1, ctr: 1, position: 1 },
        { page: 'https://example.com', date: '2026-01-01', clicks: 1, impressions: 1, ctr: 1, position: 2 },
        { page: 'https://example.com/', date: '2026-01-01', clicks: 1, impressions: 1, ctr: 1, position: 3 },
      ],
      '2026-09-07T00:00:00.000Z',
    )
    const keys = rows.map((r) => `${r.site_id}|${r.url}|${r.date}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual(['site-1|https://example.com/|2026-01-01'])
  })
})

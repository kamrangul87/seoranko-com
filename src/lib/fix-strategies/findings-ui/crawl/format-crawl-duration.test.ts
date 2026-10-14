import { describe, expect, it } from 'vitest'
import { formatCrawlDuration } from './format-crawl-duration'

describe('formatCrawlDuration', () => {
  it('formats started → finished wall clock', () => {
    expect(
      formatCrawlDuration({
        startedAt: '2026-10-14T08:00:00.000Z',
        finishedAt: '2026-10-14T08:01:23.000Z',
      }),
    ).toBe('1m 23s')
  })

  it('returns null without startedAt', () => {
    expect(
      formatCrawlDuration({ startedAt: null, finishedAt: '2026-10-14T08:01:00.000Z' }),
    ).toBeNull()
  })

  it('uses nowMs when still running', () => {
    expect(
      formatCrawlDuration({
        startedAt: '2026-10-14T08:00:00.000Z',
        finishedAt: null,
        nowMs: Date.parse('2026-10-14T08:00:45.000Z'),
      }),
    ).toBe('45s')
  })
})

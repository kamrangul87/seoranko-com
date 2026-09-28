import { describe, expect, it } from 'vitest'
import { summarizePartialCoverage } from './partial-coverage'
import type { CoverageNote } from './constants'

describe('summarizePartialCoverage', () => {
  it('names fetch failures with URLs — not just "15 of 19"', () => {
    const notes: CoverageNote[] = [
      {
        code: 'fetch_failure',
        detail: 'HTTP 404',
        url: 'https://autodun.com/ev-charger-finder',
      },
      {
        code: 'fetch_failure',
        detail: 'HTTP 404',
        url: 'https://autodun.com/data-usage',
      },
      {
        code: 'fetch_failure',
        detail: 'HTTP 404',
        url: 'https://autodun.com/terms',
      },
      {
        code: 'fetch_failure',
        detail: 'HTTP 404',
        url: 'https://autodun.com/cookies',
      },
    ]
    const summary = summarizePartialCoverage(notes, {
      urlsFound: 19,
      urlsCrawled: 15,
      urlsFailed: 4,
    })
    expect(summary.isPlanLimit).toBe(false)
    expect(summary.headline).toMatch(/15 of 19/)
    expect(summary.headline).toMatch(/4 fetch failures/)
    expect(summary.buckets).toHaveLength(1)
    expect(summary.buckets[0]!.code).toBe('fetch_failure')
    expect(summary.buckets[0]!.urls).toEqual([
      'https://autodun.com/ev-charger-finder',
      'https://autodun.com/data-usage',
      'https://autodun.com/terms',
      'https://autodun.com/cookies',
    ])
    expect(summary.buckets[0]!.details).toContain('HTTP 404')
  })

  it('flags plan page limit distinctly from fetch failures', () => {
    const notes: CoverageNote[] = [
      {
        code: 'plan_page_limit',
        detail: '50 of 120 pages crawled — Starter plan limit',
      },
    ]
    const summary = summarizePartialCoverage(notes, {
      urlsFound: 120,
      urlsCrawled: 50,
      urlsFailed: 0,
    })
    expect(summary.isPlanLimit).toBe(true)
    expect(summary.planLimitDetail).toContain('Starter')
    expect(summary.buckets).toHaveLength(0)
  })

  it('ignores informational expand/rendered notes', () => {
    const notes: CoverageNote[] = [
      {
        code: 'link_graph_expand',
        detail: 'Enqueued 2 URLs',
        url: 'https://example.com/',
      },
      {
        code: 'rendered',
        detail: 'Headless render succeeded',
        url: 'https://example.com/app',
      },
      {
        code: 'time_limit',
        detail: 'Tick deadline reached with queue remaining',
      },
    ]
    const summary = summarizePartialCoverage(notes, {
      urlsFound: 10,
      urlsCrawled: 5,
      urlsFailed: 0,
    })
    expect(summary.buckets.map((b) => b.code)).toEqual(['time_limit'])
    expect(summary.headline.toLowerCase()).toContain('tick time budget')
  })
})

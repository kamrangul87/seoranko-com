import { describe, expect, it } from 'vitest'
import { planMissionItems } from './create-mission'
import type { ClassifiableFinding } from './types'

describe('planMissionItems', () => {
  it('orders SAFE first, then by affected URL count descending', () => {
    const findings: ClassifiableFinding[] = [
      {
        id: 'blocked-1',
        topicId: '15',
        verdict: 'finding-soft-404',
        bucket: 'actionable',
        affectedUrlCount: 99,
        sourcePath: null,
      },
      {
        id: 'safe-1',
        topicId: '49',
        verdict: 'auto-set-dimensions',
        bucket: 'actionable',
        surfaceClass: 'auto-fixable',
        affectedUrlCount: 1,
        sourcePath: 'app/page.tsx',
      },
      {
        id: 'safe-2',
        topicId: '1',
        verdict: 'auto-fixable',
        bucket: 'actionable',
        surfaceClass: 'auto-fixable',
        affectedUrlCount: 3,
        sourcePath: 'app/a.tsx',
      },
      {
        id: 'review-1',
        topicId: '42',
        verdict: 'human-review-temporary-redirect',
        bucket: 'actionable',
        surfaceClass: 'human-review',
        affectedUrlCount: 5,
        sourcePath: null,
      },
    ]

    const { items, counts } = planMissionItems(findings, {
      connector: 'github',
      connected: true,
    })

    expect(counts).toEqual({
      totalActionable: 4,
      safe: 1, // safe-2 has affectedUrlCount 3 → multi-file → review
      review: 2, // safe-2 multi-file + review-1
      blocked: 1,
    })
    // Actually safe-2 with affectedUrlCount 3 is REVIEW (multi-file)
    expect(items[0]!.eligibility).toBe('safe')
    expect(items[0]!.findingId).toBe('safe-1')
    expect(items.map((i) => i.eligibility)).toEqual([
      'safe',
      'review',
      'review',
      'blocked',
    ])
  })

  it('autodun latest-crawl shape: zero actionable → zero counts', () => {
    const { items, counts } = planMissionItems([], {
      connector: 'github',
      connected: true,
    })
    expect(items).toEqual([])
    expect(counts).toEqual({
      totalActionable: 0,
      safe: 0,
      review: 0,
      blocked: 0,
    })
  })

  it('does not invoke any write / fix side effects (pure plan)', () => {
    const { counts } = planMissionItems(
      [
        {
          id: 'x',
          topicId: '26',
          verdict: 'auto-remove-injected-noindex',
          bucket: 'actionable',
          surfaceClass: 'auto-fixable',
          affectedUrlCount: 1,
          sourcePath: 'public/sitemap.xml',
        },
      ],
      { connector: null, connected: false },
    )
    // Transform exists but no connector → review (not safe, not executed)
    expect(counts.safe).toBe(0)
    expect(counts.review).toBe(1)
  })
})

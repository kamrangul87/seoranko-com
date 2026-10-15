import { describe, expect, it } from 'vitest'
import {
  idsToSupersedeAsPresentDuplicates,
  logicalPresentFindingKey,
} from './dedupe-present-findings'

describe('dedupe present findings (one issue = one row)', () => {
  it('logical key ignores trailing slash and case on pageUrl', () => {
    expect(
      logicalPresentFindingKey({
        topicId: '14',
        verdict: 'auto-self-canonical',
        pageUrl: 'https://Example.com/About.html/',
      }),
    ).toBe(
      logicalPresentFindingKey({
        topicId: '14',
        verdict: 'auto-self-canonical',
        pageUrl: 'https://example.com/About.html',
      }),
    )
  })

  it('supersedes open duplicate when regressed+open share topic+verdict+page', () => {
    const ids = idsToSupersedeAsPresentDuplicates([
      {
        id: 'older-regressed',
        topicId: '14',
        verdict: 'auto-self-canonical',
        pageUrl: 'https://seoranko-fixture.vercel.app/about.html',
        status: 'regressed',
        firstSeenAt: '2026-10-01T00:00:00.000Z',
        rollupKey: '14|auto-self-canonical|https://seoranko-fixture.vercel.app/about.html',
      },
      {
        id: 'newer-open',
        topicId: '14',
        verdict: 'auto-self-canonical',
        pageUrl: 'https://seoranko-fixture.vercel.app/about.html',
        status: 'open',
        firstSeenAt: '2026-10-10T00:00:00.000Z',
        rollupKey: '14|auto-self-canonical|https://seoranko-fixture.vercel.app/about.html|alt',
      },
      {
        id: 'unrelated',
        topicId: '49',
        verdict: 'auto-set-dimensions',
        pageUrl: 'https://seoranko-fixture.vercel.app/',
        status: 'open',
        firstSeenAt: '2026-10-01T00:00:00.000Z',
        rollupKey: '49|auto-set-dimensions|https://seoranko-fixture.vercel.app/',
      },
    ])
    expect(ids).toEqual(['newer-open'])
  })

  it('ignores resolved/superseded history rows', () => {
    const ids = idsToSupersedeAsPresentDuplicates([
      {
        id: 'open',
        topicId: '74',
        verdict: 'auto-unwrap-origin-prefix',
        pageUrl: 'https://seoranko-fixture.vercel.app/',
        status: 'open',
        firstSeenAt: '2026-10-01T00:00:00.000Z',
        rollupKey: '74|a',
      },
      {
        id: 'resolved-old',
        topicId: '74',
        verdict: 'auto-unwrap-origin-prefix',
        pageUrl: 'https://seoranko-fixture.vercel.app/',
        status: 'resolved',
        firstSeenAt: '2026-09-01T00:00:00.000Z',
        rollupKey: '74|b',
      },
    ])
    expect(ids).toEqual([])
  })
})

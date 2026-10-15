import { describe, expect, it } from 'vitest'
import { assertAllFixRunItemsVerifiedLive } from './fix-run-verify'

describe('assertAllFixRunItemsVerifiedLive', () => {
  it('passes when every fix-run item is verified_live (ignores expected.json count)', () => {
    const result = assertAllFixRunItemsVerifiedLive([
      { status: 'verified_live', topicId: '14', verdict: 'auto-self-canonical' },
      { status: 'verified_live', topicId: '49', verdict: 'auto-set-dimensions' },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.liveCount).toBe(2)
      expect(result.total).toBe(2)
    }
  })

  it('fails with an explicit list when items are not verified_live (never empty Failed:)', () => {
    const result = assertAllFixRunItemsVerifiedLive([
      { status: 'verified_live', topicId: '14', verdict: 'auto-self-canonical' },
      {
        status: 'preview_verified',
        topicId: '74',
        verdict: 'auto-unwrap-origin-prefix',
        pageUrl: 'https://seoranko-fixture.vercel.app/',
      },
      {
        status: 'failed',
        topicId: '42',
        verdict: 'auto-rewrite',
        failureReason: 'preview timeout',
      },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.detail).toMatch(/Only 1\/3 verified live/)
      expect(result.detail).toMatch(/Not live:/)
      expect(result.detail).toMatch(/74\/auto-unwrap-origin-prefix/)
      expect(result.detail).toMatch(/status=preview_verified/)
      expect(result.detail).toMatch(/42\/auto-rewrite/)
      expect(result.detail).toMatch(/preview timeout/)
      // Must never end with an empty failed list like the old "Failed: " bug
      expect(result.detail).not.toMatch(/Failed:\s*$/)
    }
  })
})

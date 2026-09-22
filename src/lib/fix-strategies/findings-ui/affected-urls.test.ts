import { describe, expect, it } from 'vitest'
import { affectedUrlsForFinding } from './affected-urls'

describe('affectedUrlsForFinding', () => {
  it('lists every member URL when rolled up (not one representative)', () => {
    const urls = [
      'https://autodun.com/blog/a.html',
      'https://autodun.com/blog/b.html',
      'https://autodun.com/blog/c.html',
      'https://autodun.com/blog/d.html',
      'https://autodun.com/blog/e.html',
    ]
    expect(
      affectedUrlsForFinding({
        pageUrl: urls[0],
        affectedUrlCount: 5,
        rolledUp: true,
        evidenceValues: { memberUrls: urls },
      }),
    ).toEqual(urls)
  })

  it('falls back to pageUrl when memberUrls absent', () => {
    expect(
      affectedUrlsForFinding({
        pageUrl: 'https://autodun.com/blog/solo.html',
        affectedUrlCount: 1,
        rolledUp: false,
        evidenceValues: null,
      }),
    ).toEqual(['https://autodun.com/blog/solo.html'])
  })

  it('dedupes memberUrls', () => {
    expect(
      affectedUrlsForFinding({
        evidenceValues: {
          memberUrls: [
            'https://a.example/x',
            'https://a.example/x',
            'https://a.example/y',
          ],
        },
      }),
    ).toEqual(['https://a.example/x', 'https://a.example/y'])
  })
})

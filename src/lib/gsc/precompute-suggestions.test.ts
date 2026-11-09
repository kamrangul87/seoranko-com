import { describe, expect, it } from 'vitest'
import {
  asPage2SuggestionsCache,
  buildPage2SuggestionsCache,
  selectUrlsForPrecompute,
} from './precompute-suggestions'
import type { QueryPageDaily } from './opportunities'

describe('selectUrlsForPrecompute', () => {
  it('keeps first unique URLs up to the limit', () => {
    expect(
      selectUrlsForPrecompute(['https://a.com/x', 'https://a.com/x', 'https://a.com/y'], 1),
    ).toEqual(['https://a.com/x'])
  })
})

describe('buildPage2SuggestionsCache', () => {
  it('fills title/meta from existing suggestion code without a paid API', async () => {
    const rows: QueryPageDaily[] = []
    for (let d = 1; d <= 28; d++) {
      const day = String(d).padStart(2, '0')
      rows.push({
        url: 'https://example.com/mot',
        query: 'mot checker dvla',
        date: `2026-10-${day}`,
        clicks: 0,
        impressions: 20,
        avg_position: 9.5,
        is_final: true,
      })
    }
    const html =
      '<html><head><title>MOT history check</title><meta name="description" content="Check MOT history"></head><body><p>mot checker dvla history</p></body></html>'
    const cache = await buildPage2SuggestionsCache({
      rows,
      limit: 1,
      nowIso: '2026-11-09T00:00:00.000Z',
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('example.com')) {
          return new Response(html, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        }
        return new Response('nope', { status: 404 })
      },
    })
    expect(cache.titleMeta['https://example.com/mot']?.currentTitle).toMatch(/MOT/i)
    expect(cache.internalLinks['https://example.com/mot']?.anchorText).toBeTruthy()
  })
})

describe('asPage2SuggestionsCache', () => {
  it('rejects junk and keeps a valid cache object', () => {
    expect(asPage2SuggestionsCache(null)).toBeNull()
    expect(asPage2SuggestionsCache({ titleMeta: {}, internalLinks: {} })?.windowDays).toBe(0)
  })
})

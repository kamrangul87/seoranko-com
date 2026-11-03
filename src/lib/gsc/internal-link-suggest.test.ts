import { describe, it, expect, vi } from 'vitest'
import { suggestInternalLinks, type SourceStrength } from './internal-link-suggest'

const makeHtml = (body: string) =>
  `<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`

describe('suggestInternalLinks', () => {
  it('returns empty when no queries', async () => {
    const out = await suggestInternalLinks({
      siteOrigin: 'https://example.com/',
      targetUrl: 'https://example.com/target',
      targetQueries: [],
      candidateSources: [],
      fetchImpl: vi.fn(),
    })
    expect(out).toEqual([])
  })

  it('picks homepage and strongest sources; skips pages already linking to target', async () => {
    const siteOrigin = 'https://example.com/'
    const targetUrl = 'https://example.com/target'
    const candidateSources: SourceStrength[] = [
      { url: 'https://example.com/blog/a', impressions: 500 },
      { url: 'https://example.com/blog/b', impressions: 300 },
      { url: 'https://example.com/blog/c', impressions: 100 },
    ]

    const fetchImpl = vi.fn(async (url: string) => {
      // Homepage: HTML without link to target
      if (url === 'https://example.com') {
        return new Response(makeHtml('<p>Welcome</p>'), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      // blog/a: HTML without link to target
      if (url.endsWith('/blog/a')) {
        return new Response(makeHtml('<p>Article A</p>'), {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      }
      // blog/b: already links to target — should be skipped
      if (url.endsWith('/blog/b')) {
        return new Response(
          makeHtml(
            `<p>See our <a href="${targetUrl}">target</a> for more</p>`,
          ),
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        )
      }
      // blog/c: non-HTML or error — should be skipped
      if (url.endsWith('/blog/c')) {
        return new Response('ok', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch

    const out = await suggestInternalLinks({
      siteOrigin,
      targetUrl,
      targetQueries: ['target topic one', 'something else'],
      candidateSources,
      fetchImpl,
      maxSuggestions: 3,
    })

    // Expect suggestions from homepage and blog/a only, with anchor = top allowed query
    expect(out.length).toBe(2)
    expect(out[0]?.sourceUrl).toBe('https://example.com')
    expect(out[1]?.sourceUrl).toBe('https://example.com/blog/a')
    expect(out.every(s => s.targetUrl === targetUrl)).toBe(true)
    expect(out.every(s => s.anchorText === 'target topic one')).toBe(true)
    expect(out.every(s => s.insertion === 'related-list')).toBe(true)
  })
})


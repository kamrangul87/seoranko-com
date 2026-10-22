import { describe, expect, it, vi, afterEach } from 'vitest'
import { safeCrawlFetch } from './safe-crawl-fetch'

vi.mock('@/lib/assert-safe-public-url-resolved', () => ({
  assertSafePublicUrlResolved: vi.fn(async () => true),
}))

vi.mock('@/lib/fetch-page-content', () => ({
  isSafePublicUrl: vi.fn(() => true),
}))

function redirect(status: number, location: string): Response {
  return new Response(null, {
    status,
    headers: { location },
  })
}

describe('safeCrawlFetch redirect loops', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('fails closed on a 2-URL loop with full chain in error', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://example.com/privacy') {
        return redirect(308, 'https://example.com/privacy/')
      }
      if (url === 'https://example.com/privacy/') {
        return redirect(308, 'https://example.com/privacy')
      }
      throw new Error(`unexpected ${url}`)
    }) as unknown as typeof fetch

    const result = await safeCrawlFetch('https://example.com/privacy')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe(
      'Redirect loop: https://example.com/privacy → https://example.com/privacy/ → https://example.com/privacy',
    )
    expect(result.redirectHops).toEqual([
      'https://example.com/privacy',
      'https://example.com/privacy/',
      'https://example.com/privacy',
    ])
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      2,
    )
  })
})

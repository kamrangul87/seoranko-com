import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkLiveSitemapUrlHealth } from './live-health'

describe('checkLiveSitemapUrlHealth', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('marks HTTP 200 as ok and flags 4XX/5XX', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/ok')) return new Response('', { status: 200 })
      if (url.includes('/missing')) return new Response('', { status: 404 })
      if (url.includes('/forbidden')) return new Response('', { status: 403 })
      return new Response('', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const results = await checkLiveSitemapUrlHealth([
      'https://example.com/ok',
      'https://example.com/missing',
      'https://example.com/forbidden',
      'https://example.com/error',
    ])

    expect(results.find((r) => r.url.includes('/ok'))?.ok).toBe(true)
    expect(results.find((r) => r.url.includes('/missing'))?.httpStatus).toBe(404)
    expect(results.find((r) => r.url.includes('/forbidden'))?.httpStatus).toBe(403)
    expect(results.filter((r) => !r.ok)).toHaveLength(3)
  })
})

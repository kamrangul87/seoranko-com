import { describe, expect, it, vi } from 'vitest'
import { fetchPreviewPage } from './fetch-preview-page'

function redirect(status: number, location: string | null): Response {
  const headers = new Headers()
  if (location) headers.set('location', location)
  return new Response(null, { status, headers })
}

describe('fetchPreviewPage', () => {
  it('detects /privacy ↔ /privacy/ loop (autodun-ai #60 class) without throwing', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input).split('?')[0]!
      if (url === 'https://preview.vercel.app/privacy') {
        return redirect(308, 'https://preview.vercel.app/privacy/')
      }
      if (url === 'https://preview.vercel.app/privacy/') {
        return redirect(308, 'https://preview.vercel.app/privacy')
      }
      throw new Error(`unexpected ${url}`)
    })

    const result = await fetchPreviewPage(
      'https://preview.vercel.app/privacy',
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )

    expect(result.ok).toBe(false)
    expect(result.redirectFailure?.kind).toBe('redirect-loop')
    expect(result.redirectFailure?.detail).toMatch(/^Redirect loop:/)
    expect(result.redirectFailure?.chain).toEqual([
      'https://preview.vercel.app/privacy',
      'https://preview.vercel.app/privacy/',
      'https://preview.vercel.app/privacy',
    ])
    // Must not keep bouncing — undici redirect:'follow' would throw instead.
    expect(fetchImpl.mock.calls.length).toBe(2)
  })

  it('swallows thrown fetch (redirect count exceeded) as transport failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed', {
        cause: new Error('redirect count exceeded'),
      })
    })
    const result = await fetchPreviewPage('https://x.vercel.app/p', {
      bypass: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.ok).toBe(false)
    expect(result.redirectFailure?.kind).toBe('transport')
    expect(result.redirectFailure?.detail).toMatch(/fetch failed|redirect count/i)
  })

  it('returns 200 body when chain ends cleanly', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/a')) return redirect(301, 'https://example.com/b')
      if (url.endsWith('/b')) {
        return new Response('<html>ok</html>', { status: 200 })
      }
      throw new Error(`unexpected ${url}`)
    })
    const result = await fetchPreviewPage('https://example.com/a', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.body).toContain('ok')
    expect(result.redirectFailure).toBeUndefined()
  })
})

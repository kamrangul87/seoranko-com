import { describe, expect, it, vi } from 'vitest'
import { fetchPreviewPage } from './fetch-preview-page'

describe('fetchPreviewPage', () => {
  it('fails closed on redirect loops without throwing', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url)
      return new Response(null, {
        status: 307,
        headers: {
          location: href.includes('hop=')
            ? href.replace(/hop=\d+/, (m) => `hop=${Number(m.slice(4)) + 1}`)
            : `${href}${href.includes('?') ? '&' : '?'}hop=1`,
        },
      })
    })

    const result = await fetchPreviewPage(
      'https://autodun-preview.vercel.app/privacy',
      { bypass: 'secret', fetchImpl: fetchImpl as unknown as typeof fetch, maxRedirects: 3 },
    )

    expect(result.ok).toBe(false)
    expect(result.status).toBe(310)
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(5)
  })

  it('returns body on 200 and treats SSO interstitial as 401', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('<html>Authentication Required</html>', { status: 200 }),
    )
    const result = await fetchPreviewPage(
      'https://x.vercel.app/privacy',
      { bypass: 'b', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
  })

  it('catches thrown fetch (redirect count exceeded) as ok:false', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed', {
        cause: new Error('redirect count exceeded'),
      })
    })
    const result = await fetchPreviewPage('https://x.vercel.app/p', {
      bypass: 'b',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ ok: false, body: '', status: 0 })
  })

  it('appends bypass query on vercel.app URLs', async () => {
    const seen: string[] = []
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      seen.push(String(url))
      return new Response('<html>ok</html>', { status: 200 })
    })
    await fetchPreviewPage('https://foo.vercel.app/privacy', {
      bypass: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(seen[0]).toContain('x-vercel-protection-bypass=tok')
  })
})

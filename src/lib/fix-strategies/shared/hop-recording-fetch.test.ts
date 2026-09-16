import { describe, expect, it, vi } from 'vitest'
import { recordRedirectHops } from './hop-recording-fetch'

function redirectResponse(status: number, location: string | null): Response {
  const headers = new Headers()
  if (location !== null) headers.set('location', location)
  return new Response(null, { status, headers })
}

function okResponse(status = 200): Response {
  return new Response('ok', { status })
}

describe('recordRedirectHops', () => {
  it('records a 3-hop redirect chain ending at 200', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://example.com/a') {
        return redirectResponse(301, 'https://example.com/b')
      }
      if (url === 'https://example.com/b') {
        return redirectResponse(302, 'https://example.com/c')
      }
      if (url === 'https://example.com/c') {
        return redirectResponse(301, 'https://example.com/final')
      }
      if (url === 'https://example.com/final') {
        return okResponse(200)
      }
      throw new Error(`unexpected url ${url}`)
    })

    const result = await recordRedirectHops('https://example.com/a', {
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(result.hops).toHaveLength(4)
    expect(result.hops.map((h) => h.status)).toEqual([301, 302, 301, 200])
    expect(result.hops.map((h) => h.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
      'https://example.com/final',
    ])
    expect(result.finalUrl).toBe('https://example.com/final')
    expect(result.finalStatus).toBe(200)
    expect(result.stoppedReason).toBe('non-3xx')
  })

  it('detects a redirect loop via repeat URL', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://example.com/loop-a') {
        return redirectResponse(301, 'https://example.com/loop-b')
      }
      if (url === 'https://example.com/loop-b') {
        return redirectResponse(302, 'https://example.com/loop-a')
      }
      throw new Error(`unexpected url ${url}`)
    })

    const result = await recordRedirectHops('https://example.com/loop-a', {
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(result.stoppedReason).toBe('repeat-url')
    expect(result.hops).toHaveLength(2)
    expect(result.hops[1]!.location).toBe('https://example.com/loop-a')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stops at max-hops and does not follow an 11th hop (default 10)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const match = /\/hop-(\d+)$/.exec(url)
      if (!match) throw new Error(`unexpected url ${url}`)
      const n = Number(match[1])
      return redirectResponse(301, `https://example.com/hop-${n + 1}`)
    })

    const result = await recordRedirectHops('https://example.com/hop-1', {
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(result.stoppedReason).toBe('max-hops')
    expect(result.hops).toHaveLength(10)
    expect(result.hops[9]!.url).toBe('https://example.com/hop-10')
    expect(result.hops[9]!.location).toBe('https://example.com/hop-11')
    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(
      fetchMock.mock.calls.some(
        (c) => String(c[0]) === 'https://example.com/hop-11',
      ),
    ).toBe(false)
  })

  it('resolves relative Location headers against the current URL', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://example.com/dir/page') {
        return redirectResponse(301, '../other')
      }
      if (url === 'https://example.com/other') {
        return okResponse(200)
      }
      throw new Error(`unexpected url ${url}`)
    })

    const result = await recordRedirectHops('https://example.com/dir/page', {
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(result.hops[0]!.location).toBe('https://example.com/other')
    expect(result.finalUrl).toBe('https://example.com/other')
    expect(result.finalStatus).toBe(200)
    expect(result.stoppedReason).toBe('non-3xx')
  })
})

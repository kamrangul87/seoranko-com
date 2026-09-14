import { describe, expect, it, vi } from 'vitest'
import { classifyHttpStatus, fetchUrl } from './fetch-url'
import { parseRetryAfter } from './parse-retry-after'
import { fetchWithEvidence } from './evidence'
import type { FetchDeps } from './types'

function httpResponse(
  status: number,
  body = '',
  headerInit?: Record<string, string>,
): Response {
  return new Response(body, { status, headers: headerInit })
}

function depsWith(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
  extras?: Partial<FetchDeps>,
): FetchDeps {
  return {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      return handler(url, init)
    }) as unknown as typeof fetch,
    sleep: vi.fn(async () => {}),
    now: () => 1_000_000,
    config: {
      fallbackDelayMs: 50,
      maxAttempts: 2,
      maxRetryAfterMs: 1_000,
      timeoutMs: 500,
    },
    ...extras,
  }
}

describe('classifyHttpStatus', () => {
  it('separates 404, 410, 429, 503 from other classes', () => {
    expect(classifyHttpStatus(404)).toBe('404')
    expect(classifyHttpStatus(410)).toBe('410')
    expect(classifyHttpStatus(403)).toBe('4xx-other')
    expect(classifyHttpStatus(429)).toBe('429')
    expect(classifyHttpStatus(503)).toBe('503')
    expect(classifyHttpStatus(500)).toBe('5xx-other')
    expect(classifyHttpStatus(200)).toBe('2xx')
    expect(classifyHttpStatus(301)).toBe('3xx')
  })
})

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('120', 0)).toBe(120_000)
  })

  it('parses HTTP-date relative to now', () => {
    const now = Date.parse('Wed, 21 Oct 2015 07:28:00 GMT')
    const value = 'Wed, 21 Oct 2015 07:28:05 GMT'
    expect(parseRetryAfter(value, now)).toBe(5_000)
  })

  it('treats malformed values as absent, never zero from garbage', () => {
    expect(parseRetryAfter('not-a-date', 0)).toBeNull()
    expect(parseRetryAfter('', 0)).toBeNull()
    expect(parseRetryAfter(null, 0)).toBeNull()
  })
})

describe('fetchUrl', () => {
  it('does not follow redirects and returns status/headers/body', async () => {
    const deps = depsWith(() =>
      httpResponse(302, 'moved', { location: '/elsewhere' }),
    )
    const outcome = await fetchUrl('https://example.com/a', deps)
    expect(outcome.kind).toBe('http')
    if (outcome.kind === 'http') {
      expect(outcome.status).toBe(302)
      expect(outcome.headers.get('location')).toBe('/elsewhere')
      expect(outcome.body).toBe('moved')
    }
    const init = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]
    expect(init.redirect).toBe('manual')
  })

  it('classifies timeout', async () => {
    const deps = depsWith(async () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    })
    const outcome = await fetchUrl('https://example.com/slow', deps)
    expect(outcome.kind).toBe('timeout')
  })

  it('classifies DNS failure', async () => {
    const deps = depsWith(async () => {
      throw new Error('getaddrinfo ENOTFOUND example.invalid')
    })
    const outcome = await fetchUrl('https://example.invalid/', deps)
    expect(outcome.kind).toBe('dns-failure')
  })

  it('classifies connection reset', async () => {
    const deps = depsWith(async () => {
      throw new Error('socket hang up ECONNRESET')
    })
    const outcome = await fetchUrl('https://example.com/reset', deps)
    expect(outcome.kind).toBe('connection-reset')
  })

  it('sends cache-bypass headers when requested', async () => {
    const deps = depsWith(() => httpResponse(200, 'ok'))
    await fetchUrl('https://example.com/', deps, { bypassCache: true })
    const init = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]
    const headers = new Headers(init.headers)
    expect(headers.get('Cache-Control')).toBe('no-cache')
    expect(init.cache).toBe('no-store')
  })
})

describe('fetchWithEvidence', () => {
  it('accepts a single 410 observation without re-fetch', async () => {
    const deps = depsWith(() => httpResponse(410, 'gone'))
    const result = await fetchWithEvidence('https://example.com/gone', deps)
    expect(result.stable).toBe(true)
    expect(result.attempts).toHaveLength(1)
    expect(deps.fetch).toHaveBeenCalledTimes(1)
  })

  it('re-fetches 404 and accepts when status matches', async () => {
    const deps = depsWith(() => httpResponse(404, 'missing'))
    const result = await fetchWithEvidence('https://example.com/missing', deps)
    expect(result.stable).toBe(true)
    if (result.stable) {
      expect(result.outcome.kind).toBe('http')
      if (result.outcome.kind === 'http') expect(result.outcome.status).toBe(404)
    }
    expect(result.attempts).toHaveLength(2)
    expect(deps.sleep).toHaveBeenCalled()
  })

  it('suppresses when statuses differ across attempts', async () => {
    let n = 0
    const deps = depsWith(() => {
      n += 1
      return httpResponse(n === 1 ? 404 : 200, 'flip')
    })
    const result = await fetchWithEvidence('https://example.com/flip', deps)
    expect(result.stable).toBe(false)
    if (!result.stable) expect(result.reason).toBe('unstable-status')
  })

  it('honours Retry-After delta-seconds on 429 and does not raise as stable link evidence', async () => {
    const deps = depsWith(() =>
      httpResponse(429, 'slow down', { 'retry-after': '2' }),
    )
    const result = await fetchWithEvidence('https://example.com/rl', deps)
    expect(result.stable).toBe(false)
    if (!result.stable) expect(result.reason).toBe('non-actionable')
    // 2s → 2000ms, capped by test maxRetryAfterMs 1000
    expect(deps.sleep).toHaveBeenCalledWith(1_000)
  })

  it('treats malformed Retry-After as absent (uses fallback, never zero)', async () => {
    const deps = depsWith(() =>
      httpResponse(503, 'busy', { 'retry-after': 'garbage' }),
    )
    await fetchWithEvidence('https://example.com/busy', deps)
    expect(deps.sleep).toHaveBeenCalledWith(50)
  })
})

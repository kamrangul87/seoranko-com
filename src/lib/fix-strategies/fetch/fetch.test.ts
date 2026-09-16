import { describe, expect, it, vi } from 'vitest'
import { classifyHttpStatus, fetchUrl } from './fetch-url'
import { parseRetryAfter } from './parse-retry-after'
import { fetchWithEvidence } from './evidence'
import { probeContentSignals, requireCompleteStream } from './detector-guard'
import type { FetchDeps, FetchOutcome } from './types'

function httpResponse(
  status: number,
  body = '',
  headerInit?: Record<string, string>,
): Response {
  return new Response(body, { status, headers: headerInit })
}

function streamingResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  let i = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]!))
        i += 1
      } else {
        controller.close()
      }
    },
  })
  return new Response(stream, { status })
}

function truncatedStreamResponse(firstChunk: string): Response {
  const encoder = new TextEncoder()
  let sent = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        controller.enqueue(encoder.encode(firstChunk))
        sent = true
        return
      }
      controller.error(new Error('stream truncated'))
    },
  })
  return new Response(stream, { status: 200 })
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
      expect(outcome.streamComplete).toBe(true)
    }
    const init = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]
    expect(init.redirect).toBe('manual')
  })

  it('reads a multi-chunk stream to completion (topic 67)', async () => {
    const deps = depsWith(() =>
      streamingResponse(['<html><body>', 'hello world', '</body></html>']),
    )
    const outcome = await fetchUrl('https://example.com/stream', deps)
    expect(outcome.kind).toBe('http')
    if (outcome.kind === 'http') {
      expect(outcome.streamComplete).toBe(true)
      expect(outcome.body).toBe('<html><body>hello world</body></html>')
    }
  })

  it('marks streamComplete false when the body stream errors mid-read', async () => {
    const deps = depsWith(() => truncatedStreamResponse('<html>partial'))
    const outcome = await fetchUrl('https://example.com/trunc', deps)
    expect(outcome.kind).toBe('http')
    if (outcome.kind === 'http') {
      expect(outcome.streamComplete).toBe(false)
      expect(outcome.body).toContain('partial')
    }
  })

  it('classifies timeout', async () => {
    const deps = depsWith(async () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    })
    const outcome = await fetchUrl('https://example.com/slow', deps)
    expect(outcome.kind).toBe('timeout')
    expect(outcome.streamComplete).toBe(false)
  })

  it('classifies DNS failure', async () => {
    const deps = depsWith(async () => {
      throw new Error('getaddrinfo ENOTFOUND example.invalid')
    })
    const outcome = await fetchUrl('https://example.invalid/', deps)
    expect(outcome.kind).toBe('dns-failure')
    expect(outcome.streamComplete).toBe(false)
  })

  it('classifies connection reset', async () => {
    const deps = depsWith(async () => {
      throw new Error('socket hang up ECONNRESET')
    })
    const outcome = await fetchUrl('https://example.com/reset', deps)
    expect(outcome.kind).toBe('connection-reset')
    expect(outcome.streamComplete).toBe(false)
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

describe('topic 67 stream-completion detector guard', () => {
  const lateStreamHtml = [
    '<!doctype html><html><head>',
    '<title>Streamed</title>',
    '<meta name="description" content="later chunk">',
    '<script type="application/ld+json">{"@type":"WebPage"}</script>',
    '</head><body>',
    '<p>Substantial streamed article body with enough words for content.</p>',
    '<a href="/about">About</a>',
    '</body></html>',
  ]

  const emptyHtml = '<!doctype html><html><head></head><body></body></html>'

  it('complete stream with content in later chunks → zero content/link/metadata/SD findings', async () => {
    const deps = depsWith(() => streamingResponse(lateStreamHtml))
    const outcome = await fetchUrl('https://example.com/late', deps)
    const probed = probeContentSignals(outcome)
    expect(probed.refused).toBe(false)
    if (!probed.refused) expect(probed.findings).toEqual([])
  })

  it('genuinely empty complete HTML → content, link, metadata and SD findings', async () => {
    const deps = depsWith(() => httpResponse(200, emptyHtml))
    const outcome = await fetchUrl('https://example.com/empty', deps)
    const probed = probeContentSignals(outcome)
    expect(probed.refused).toBe(false)
    if (!probed.refused) {
      const kinds = probed.findings.map((f) => f.kind).sort()
      expect(kinds).toEqual([
        'missing-internal-link',
        'missing-metadata',
        'missing-structured-data',
        'thin-or-empty-content',
      ])
      for (const f of probed.findings) {
        expect(f.presence).toBe('client_only')
      }
    }
  })

  it('incomplete stream → detectors refuse rather than classify the prefix', async () => {
    const deps = depsWith(() => truncatedStreamResponse('<html><body></body>'))
    const outcome = await fetchUrl('https://example.com/incomplete', deps)
    expect(requireCompleteStream(outcome).refused).toBe(true)
    const probed = probeContentSignals(outcome)
    expect(probed.refused).toBe(true)
    if (probed.refused) expect(probed.reason).toBe('stream_incomplete')
  })

  it('manual incomplete outcome is refused', () => {
    const outcome: FetchOutcome = {
      kind: 'http',
      status: 200,
      statusClass: '2xx',
      headers: new Headers(),
      body: '<html></html>',
      url: 'https://example.com/',
      streamComplete: false,
    }
    expect(probeContentSignals(outcome).refused).toBe(true)
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

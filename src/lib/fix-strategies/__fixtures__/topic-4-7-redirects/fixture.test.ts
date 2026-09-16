import { describe, expect, it, vi } from 'vitest'
import {
  detectRedirectTopics,
  collapseRedirectInConfig,
  verifyLiveChainCollapsed,
  rejectedHomepageRepoint,
  severityForChainHops,
} from '@/lib/fix-strategies/redirect-chain'
import type { FetchDeps } from '@/lib/fix-strategies/fetch'

function redirect(status: number, location: string | null): Response {
  const headers = new Headers()
  if (location) headers.set('location', location)
  return new Response(null, { status, headers })
}

function html(body: string, noindex = false): Response {
  const robots = noindex
    ? '<meta name="robots" content="noindex">'
    : ''
  return new Response(
    `<!doctype html><html><head>${robots}<title>t</title></head><body>${body}</body></html>`,
    { status: 200, headers: { 'content-type': 'text/html' } },
  )
}

function fetchDeps(fetchImpl: typeof fetch): FetchDeps {
  return {
    fetch: fetchImpl,
    sleep: async () => {},
    now: () => 0,
    config: { fallbackDelayMs: 1, maxAttempts: 2, maxRetryAfterMs: 1000 },
  }
}

describe('topics 4–7 — one chain walk, four classifiers', () => {
  it('topic 4 dossier: hop bands, middleware, 11-hop, 1-hop, route 404 to topic 7', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      // 3-hop chain → 200
      if (url.endsWith('/c3-a')) return redirect(301, 'https://example.com/c3-b')
      if (url.endsWith('/c3-b')) return redirect(301, 'https://example.com/c3-c')
      if (url.endsWith('/c3-c')) return redirect(301, 'https://example.com/c3-final')
      if (url.endsWith('/c3-final')) return html('<p>ok</p>')

      // 5-hop path to get 4 redirects: c4-1→2→3→4→5(200)
      if (url.includes('/c4-')) {
        const n = Number(/c4-(\d+)/.exec(url)?.[1] ?? 0)
        if (n < 5) return redirect(301, `https://example.com/c4-${n + 1}`)
        return html('<p>ok</p>')
      }

      // 11-hop
      if (url.includes('/h11-')) {
        const n = Number(/h11-(\d+)/.exec(url)?.[1] ?? 0)
        return redirect(301, `https://example.com/h11-${n + 1}`)
      }

      // 1-hop
      if (url.endsWith('/one')) return redirect(301, 'https://example.com/one-final')
      if (url.endsWith('/one-final')) return html('<p>ok</p>')

      // chain to 404
      if (url.endsWith('/to404')) return redirect(301, 'https://example.com/gone')
      if (url.endsWith('/gone')) return new Response('gone', { status: 404 })

      // middleware chain (same as 3-hop structurally)
      if (url.endsWith('/mw-a')) return redirect(301, 'https://example.com/mw-b')
      if (url.endsWith('/mw-b')) return redirect(301, 'https://example.com/mw-final')
      if (url.endsWith('/mw-final')) return html('<p>ok</p>')

      return new Response('no', { status: 404 })
    })

    const deps = { fetch: fetchMock as unknown as typeof fetch }
    const fd = fetchDeps(fetchMock as unknown as typeof fetch)

    const result = await detectRedirectTopics(
      [
        {
          url: 'https://example.com/c3-a',
          allHopsStaticInRepo: true,
        },
        {
          url: 'https://example.com/c4-1',
          allHopsStaticInRepo: true,
        },
        { url: 'https://example.com/h11-1' },
        { url: 'https://example.com/one' },
        {
          url: 'https://example.com/to404',
          terminalOverride: { confirmed4xx: true },
        },
        {
          url: 'https://example.com/mw-a',
          middlewareIndeterminate: true,
        },
      ],
      { deps, fetchDeps: fd },
    )

    const by = (u: string) => result.findings.find((f) => f.originUrl === u)!

    expect(by('https://example.com/c3-a').topic4.severity).toBe('moderate')
    expect(by('https://example.com/c3-a').topic4.hopCount).toBe(3)
    expect(by('https://example.com/c3-a').topic4.autoFixable).toBe(true)
    expect(by('https://example.com/c3-a').topic4.verdict).toBe(
      'auto-collapse-static',
    )

    expect(by('https://example.com/c4-1').topic4.severity).toBe('high')
    expect(by('https://example.com/c4-1').topic4.hopCount).toBe(4)

    expect(by('https://example.com/h11-1').topic4.verdict).toBe(
      'hard-failure-over-10',
    )
    expect(severityForChainHops(11)).toBe('hard-failure')

    expect(by('https://example.com/one').topic4.verdict).toBe('ok-single-hop')

    expect(by('https://example.com/to404').topic4.verdict).toBe(
      'route-topic-7-terminal-not-200',
    )
    expect(by('https://example.com/to404').topic7.verdict).toBe(
      'finding-terminal-4xx',
    )

    expect(by('https://example.com/mw-a').topic4.verdict).toBe(
      'indeterminate-middleware',
    )
  })

  it('topic 5 dossier: self-redirect, cycles, missing Location, slash not loop, 11-hop→4', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/self')) return redirect(301, 'https://example.com/self')
      if (url.endsWith('/la')) return redirect(301, 'https://example.com/lb')
      if (url.endsWith('/lb')) return redirect(302, 'https://example.com/la')
      if (url.endsWith('/x')) return redirect(301, 'https://example.com/y')
      if (url.endsWith('/y')) return redirect(301, 'https://example.com/z')
      if (url.endsWith('/z')) return redirect(302, 'https://example.com/x')
      if (url.includes('/long-')) {
        const n = Number(/long-(\d+)/.exec(url)?.[1] ?? 0)
        return redirect(301, `https://example.com/long-${n + 1}`)
      }
      if (url.endsWith('/noloc')) return redirect(302, null)
      if (url === 'https://example.com/page') {
        return redirect(301, 'https://example.com/page/')
      }
      if (url === 'https://example.com/page/') return html('<p>ok</p>')
      return new Response('no', { status: 404 })
    })
    const deps = { fetch: fetchMock as unknown as typeof fetch }

    const result = await detectRedirectTopics(
      [
        { url: 'https://example.com/self' },
        { url: 'https://example.com/la' },
        { url: 'https://example.com/x' },
        { url: 'https://example.com/long-1' },
        { url: 'https://example.com/noloc' },
        { url: 'https://example.com/page' },
      ],
      { deps },
    )
    const by = (u: string) => result.findings.find((f) => f.originUrl === u)!

    expect(by('https://example.com/self').topic5.verdict).toBe(
      'finding-self-redirect',
    )
    expect(by('https://example.com/la').topic5.verdict).toBe('finding-loop')
    expect(by('https://example.com/la').topic5.cycle).toEqual([
      'https://example.com/la',
      'https://example.com/lb',
      'https://example.com/la',
    ])
    expect(by('https://example.com/x').topic5.verdict).toBe('finding-loop')
    expect(by('https://example.com/long-1').topic5.verdict).toBe(
      'route-topic-4-max-hops',
    )
    expect(by('https://example.com/noloc').topic5.verdict).toBe(
      'finding-missing-location',
    )
    expect(by('https://example.com/page').topic5.verdict).toBe('ok')
    expect(by('https://example.com/page').topic4.verdict).toBe('ok-single-hop')
  })

  it('topic 6 dossier: permanence evidence required; always human-review', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/gone-origin')) {
        return redirect(302, 'https://example.com/new')
      }
      if (url.endsWith('/still-there')) {
        return redirect(302, 'https://example.com/new')
      }
      if (url.endsWith('/mw302')) {
        return redirect(307, 'https://example.com/new')
      }
      if (url.endsWith('/ok301')) {
        return redirect(301, 'https://example.com/new')
      }
      if (url.endsWith('/new')) return html('<p>ok</p>')
      return new Response('no', { status: 404 })
    })
    const deps = { fetch: fetchMock as unknown as typeof fetch }

    const result = await detectRedirectTopics(
      [
        {
          url: 'https://example.com/gone-origin',
          originRouteExists: false,
          permanence: {
            originAbsentFromRepo: true,
            observedAcrossCrawls: false,
            staticConfigDeclaration: false,
          },
        },
        {
          url: 'https://example.com/still-there',
          originRouteExists: true,
          permanence: {
            originAbsentFromRepo: false,
            observedAcrossCrawls: false,
            staticConfigDeclaration: false,
          },
        },
        {
          url: 'https://example.com/mw302',
          middlewareIndeterminate: true,
          permanence: {
            originAbsentFromRepo: true,
            observedAcrossCrawls: false,
            staticConfigDeclaration: false,
          },
        },
        { url: 'https://example.com/ok301' },
      ],
      { deps },
    )
    const by = (u: string) => result.findings.find((f) => f.originUrl === u)!

    expect(by('https://example.com/gone-origin').topic6.verdict).toBe(
      'human-review-permanent-302',
    )
    expect(by('https://example.com/gone-origin').topic6.autoFixable).toBe(false)

    expect(by('https://example.com/still-there').topic6.verdict).toBe(
      'suppress-origin-still-exists',
    )

    expect(by('https://example.com/mw302').topic6.verdict).toBe(
      'indeterminate-middleware',
    )

    expect(by('https://example.com/ok301').topic6.verdict).toBe('ok')
  })

  it('topic 7 dossier: 4xx, declared noindex, injected noindex, transient 5xx, temp, healthy', async () => {
    let fiveXxCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/r404')) return redirect(301, 'https://example.com/missing')
      if (url.endsWith('/missing')) return new Response('gone', { status: 404 })

      if (url.endsWith('/r-declared')) {
        return redirect(301, 'https://example.com/private')
      }
      if (url.endsWith('/private')) {
        return html('<p>secret</p>', true)
      }

      if (url.endsWith('/r-inject')) {
        return redirect(301, 'https://example.com/soft')
      }
      if (url.endsWith('/soft')) return html('<p>empty</p>', true)

      if (url.endsWith('/r5xx')) return redirect(301, 'https://example.com/flaky')
      if (url.endsWith('/flaky')) {
        fiveXxCalls++
        if (fiveXxCalls === 1) return new Response('busy', { status: 503 })
        return html('<p>recovered</p>')
      }

      if (url.endsWith('/r-temp')) {
        return redirect(302, 'https://example.com/maint')
      }
      if (url.endsWith('/maint')) return new Response('down', { status: 503 })

      if (url.endsWith('/r-ok')) return redirect(301, 'https://example.com/healthy')
      if (url.endsWith('/healthy')) return html('<p>ok</p>')

      return new Response('no', { status: 404 })
    })
    const deps = { fetch: fetchMock as unknown as typeof fetch }
    const fd = fetchDeps(fetchMock as unknown as typeof fetch)

    const result = await detectRedirectTopics(
      [
        {
          url: 'https://example.com/r404',
          terminalOverride: { confirmed4xx: true },
        },
        {
          url: 'https://example.com/r-declared',
          terminalOverride: { repoDeclaredNoindex: true },
        },
        {
          url: 'https://example.com/r-inject',
          terminalOverride: { injectedNoindexSoft404: true },
        },
        {
          url: 'https://example.com/r5xx',
          terminalOverride: { transient5xx: true },
        },
        {
          url: 'https://example.com/r-temp',
          temporaryToUnavailable: true,
          terminalOverride: { transient5xx: true },
        },
        { url: 'https://example.com/r-ok' },
      ],
      { deps, fetchDeps: fd },
    )
    const by = (u: string) => result.findings.find((f) => f.originUrl === u)!

    expect(by('https://example.com/r404').topic7.verdict).toBe(
      'finding-terminal-4xx',
    )
    expect(by('https://example.com/r-declared').topic7.verdict).toBe(
      'suppress-repo-declared-noindex',
    )
    expect(by('https://example.com/r-inject').topic7.verdict).toBe(
      'finding-soft-404-injected',
    )
    expect(by('https://example.com/r5xx').topic7.verdict).toBe(
      'route-topic-3-transient-5xx',
    )
    expect(by('https://example.com/r-temp').topic7.verdict).toBe(
      'human-review-temporary-to-unavailable',
    )
    expect(by('https://example.com/r-ok').topic7.verdict).toBe('ok')
  })

  it('severity independent of auto-fixability; homepage repoint rejected', async () => {
    expect(severityForChainHops(2)).toBe('moderate')
    expect(severityForChainHops(4)).toBe('high')
    expect(severityForChainHops(11)).toBe('hard-failure')

    expect(() => rejectedHomepageRepoint()).toThrow(/REJECTED/)

    const { source, updated } = collapseRedirectInConfig(
      `module.exports = { async redirects() { return [{ source: '/a', destination: '/b', permanent: true }] } }`,
      '/a',
      '/final',
    )
    expect(updated).toBe(true)
    expect(source).toContain("destination: '/final'")

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/a')) return redirect(301, 'https://example.com/final')
      if (url.endsWith('/final')) return html('<p>ok</p>')
      return new Response('no', { status: 404 })
    })
    const v = await verifyLiveChainCollapsed('https://example.com/a', {
      fetch: fetchMock as unknown as typeof fetch,
    })
    expect(v.ok).toBe(true)
  })

  it('walks the chain exactly once per URL (not four times)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/once-a')) return redirect(301, 'https://example.com/once-b')
      if (url.endsWith('/once-b')) return redirect(301, 'https://example.com/once-final')
      if (url.endsWith('/once-final')) return html('<p>ok</p>')
      return new Response('no', { status: 404 })
    })
    await detectRedirectTopics(
      [{ url: 'https://example.com/once-a', allHopsStaticInRepo: true }],
      { deps: { fetch: fetchMock as unknown as typeof fetch } },
    )
    // 3 fetches for the chain — not 3×4
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

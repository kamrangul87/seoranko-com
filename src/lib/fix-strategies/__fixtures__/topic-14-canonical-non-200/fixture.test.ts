import { describe, expect, it, vi } from 'vitest'
import {
  detectCanonicalTargetNot200,
  setHeadCanonicalHref,
  verifyLiveCanonicalTarget200,
} from '@/lib/fix-strategies/topic-14'

const ORIGIN = 'https://example.com'

function htmlWithCanonical(target: string): string {
  return `<!doctype html><html><head>
    <link rel="canonical" href="${target}">
  </head><body><p>hi</p></body></html>`
}

describe('topic 14 — canonical points to non-200', () => {
  it('classifies the dossier fixture set', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url).pathname

      if (path === '/gone') {
        return new Response('gone', { status: 404 })
      }
      if (path === '/flaky') {
        // Transient 5xx — second call 200
        const n = (fetchMock as unknown as { _n?: number })._n ?? 0
        ;(fetchMock as unknown as { _n?: number })._n = n + 1
        if (n === 0) return new Response('busy', { status: 503 })
        return new Response('ok', { status: 200 })
      }
      if (path === '/old') {
        return new Response(null, {
          status: 301,
          headers: { location: `${ORIGIN}/new` },
        })
      }
      if (path === '/new') {
        return new Response('ok', { status: 200 })
      }
      if (path === '/soft') {
        return new Response(
          '<!doctype html><html><head><meta name="robots" content="noindex"></head><body>empty</body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        )
      }
      if (path === '/healthy') {
        return new Response('ok', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      if (path === '/doc.pdf') {
        return new Response('%PDF', {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        })
      }
      return new Response('no', { status: 404 })
    })

    const pages = [
      {
        url: `${ORIGIN}/a`,
        body: htmlWithCanonical(`${ORIGIN}/gone`),
        pageReturns200: true,
        repoSiteKind: 'page' as const,
      },
      {
        url: `${ORIGIN}/b`,
        body: htmlWithCanonical(`${ORIGIN}/flaky`),
        pageReturns200: true,
        repoSiteKind: 'page' as const,
      },
      {
        url: `${ORIGIN}/c`,
        body: htmlWithCanonical(`${ORIGIN}/old`),
        pageReturns200: true,
        repoSiteKind: 'page' as const,
      },
      {
        url: `${ORIGIN}/d`,
        body: htmlWithCanonical(`${ORIGIN}/soft`),
        pageReturns200: true,
        repoSiteKind: 'page' as const,
        soft404Provable: true,
      },
      {
        url: `${ORIGIN}/e`,
        body: htmlWithCanonical(`${ORIGIN}/healthy`),
        pageReturns200: true,
        repoSiteKind: 'page' as const,
      },
      {
        url: `${ORIGIN}/f`,
        body: htmlWithCanonical(`${ORIGIN}/doc.pdf`),
        pageReturns200: true,
        repoSiteKind: 'page' as const,
      },
    ]

    const result = await detectCanonicalTargetNot200(pages, {
      deps: { fetch: fetchMock as unknown as typeof fetch },
      siteOrigin: ORIGIN,
    })

    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/a`)?.verdict,
    ).toBe('auto-self-canonical')

    expect(
      result.routed.find((r) => r.pageUrl === `${ORIGIN}/b`)?.verdict,
    ).toBe('route-topic-3-transient-5xx')

    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/c`)?.kind,
    ).toBe('canonical/chain')

    expect(
      result.findings.find((f) => f.pageUrl === `${ORIGIN}/d`)?.kind,
    ).toBe('canonical/soft-404-target')

    expect(result.ok.map((o) => o.pageUrl)).toEqual(
      expect.arrayContaining([`${ORIGIN}/e`, `${ORIGIN}/f`]),
    )
  })

  it('fixer + verifier: self-canonical then target 200', async () => {
    const before = htmlWithCanonical(`${ORIGIN}/gone`)
    const { html, updated } = setHeadCanonicalHref(before, `${ORIGIN}/a`)
    expect(updated).toBe(1)

    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    const v = await verifyLiveCanonicalTarget200(
      html,
      new Headers(),
      `${ORIGIN}/a`,
      'text/html',
      { fetch: fetchMock as unknown as typeof fetch },
    )
    expect(v.ok).toBe(true)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { detectTrailingSlashDuplicates } from '@/lib/fix-strategies/topic-8'
import {
  setTrailingSlashConfig,
  verifyLiveDuplicateNormalized,
} from '@/lib/fix-strategies/duplicate-url'

const ORIGIN = 'https://example.com'

function html(body: string, canonical?: string): string {
  const c = canonical
    ? `<link rel="canonical" href="${canonical}">`
    : ''
  return `<!doctype html><html><head>${c}<title>t</title></head><body>${body}</body></html>`
}

describe('topic 8 — trailing slash duplicates', () => {
  it('classifies the dossier fixture set', async () => {
    const bodies: Record<string, string> = {
      '/page': html('<p>identical content here</p>', `${ORIGIN}/page`),
      '/page/': html('<p>identical content here</p>', `${ORIGIN}/page`),
      '/diff': html('<p>version A</p>'),
      '/diff/': html('<p>version B different</p>'),
      '/redir': html('<p>x</p>'),
      // /redir/ redirects
      '/': html('<p>home</p>'),
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input))
      const path = u.pathname
      if (path === '/redir/') {
        return new Response(null, {
          status: 301,
          headers: { location: `${ORIGIN}/redir` },
        })
      }
      const body = bodies[path]
      if (!body) return new Response('no', { status: 404 })
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    })

    const deps = { fetch: fetchMock as unknown as typeof fetch }

    // 1. both 200 identical → finding (signals agree)
    const identical = await detectTrailingSlashDuplicates(
      [{ url: `${ORIGIN}/page`, body: bodies['/page'] }],
      {
        deps,
        signals: {
          canonicals: [`${ORIGIN}/page`],
          sitemapUrls: [`${ORIGIN}/page`],
          internalLinkUrls: [`${ORIGIN}/page`, `${ORIGIN}/page`],
          trailingSlashConfig: false,
        },
      },
    )
    expect(identical.findings[0]?.verdict).toBe('human-review-blast-radius')
    expect(identical.findings[0]?.contentSame).toBe(true)
    expect(identical.findings[0]?.declarationSite).toBe('config:next.config.js')
    expect(identical.findings[0]?.discoverability).toBe('discovered')

    // 2. different content → suppressed
    const different = await detectTrailingSlashDuplicates(
      [{ url: `${ORIGIN}/diff`, body: bodies['/diff'] }],
      { deps },
    )
    expect(
      different.suppressed.some(
        (s) => s.verdict === 'suppress-different-content',
      ),
    ).toBe(true)

    // 3. already redirects → suppressed
    const redir = await detectTrailingSlashDuplicates(
      [{ url: `${ORIGIN}/redir`, body: bodies['/redir'] }],
      { deps },
    )
    expect(
      redir.suppressed.some((s) => s.verdict === 'ok-already-normalises'),
    ).toBe(true)

    // 4. site root → suppressed
    const root = await detectTrailingSlashDuplicates(
      [{ url: `${ORIGIN}/`, body: bodies['/'] }],
      { deps },
    )
    expect(
      root.suppressed.some((s) => s.verdict === 'suppress-site-root'),
    ).toBe(true)

    // 5. sitemap vs links conflict → human-review
    const conflict = await detectTrailingSlashDuplicates(
      [{ url: `${ORIGIN}/page`, body: bodies['/page'] }],
      {
        deps,
        signals: {
          sitemapUrls: [`${ORIGIN}/page/`],
          internalLinkUrls: [`${ORIGIN}/page`, `${ORIGIN}/page`],
        },
      },
    )
    expect(conflict.findings[0]?.verdict).toBe(
      'human-review-preferred-conflict',
    )
  })

  it('fixer sets trailingSlash; verifier checks live redirect', async () => {
    const { source, updated } = setTrailingSlashConfig(
      'module.exports = {\n  reactStrictMode: true,\n}\n',
      false,
    )
    expect(updated).toBe(true)
    expect(source).toContain('trailingSlash: false')

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input))
      if (u.pathname === '/page/') {
        return new Response(null, {
          status: 308,
          headers: { location: `${ORIGIN}/page` },
        })
      }
      return new Response(
        html('<p>ok</p>', `${ORIGIN}/page`),
        { status: 200, headers: { 'content-type': 'text/html' } },
      )
    })

    const v = await verifyLiveDuplicateNormalized(
      `${ORIGIN}/page`,
      `${ORIGIN}/page/`,
      { fetch: fetchMock as unknown as typeof fetch },
    )
    expect(v.ok).toBe(true)
  })
})

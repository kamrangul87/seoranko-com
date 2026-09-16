import { describe, expect, it, vi } from 'vitest'
import { detectHttpHttpsDuplicates } from '@/lib/fix-strategies/topic-9'

const HOST = 'example.com'
const body = '<!doctype html><html><head><link rel="canonical" href="https://example.com/a"><title>t</title></head><body><p>same</p></body></html>'
const bodyDiff = '<!doctype html><html><head><title>t</title></head><body><p>other</p></body></html>'

describe('topic 9 — http vs https duplicates', () => {
  it('classifies the dossier fixture set', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input))
      if (u.pathname === '/redir' && u.protocol === 'http:') {
        return new Response(null, {
          status: 301,
          headers: { location: `https://${HOST}/redir` },
        })
      }
      if (u.pathname === '/diff' && u.protocol === 'http:') {
        return new Response(bodyDiff, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    })
    const deps = { fetch: fetchMock as unknown as typeof fetch }

    // 1. both 200 identical → auto-redirect (HTTPS preferred)
    const ok = await detectHttpHttpsDuplicates(
      [{ url: `https://${HOST}/a`, body }],
      { deps },
    )
    expect(ok.findings[0]?.verdict).toBe('auto-redirect')
    expect(ok.findings[0]?.preferred).toMatchObject({
      status: 'resolved',
      source: 'google-prefers-https',
    })

    // 2. HTTP already redirects → suppressed
    const redir = await detectHttpHttpsDuplicates(
      [{ url: `https://${HOST}/redir`, body }],
      { deps },
    )
    expect(
      redir.suppressed.some((s) => s.verdict === 'ok-already-normalises'),
    ).toBe(true)

    // 3. invalid TLS → human-review
    const tls = await detectHttpHttpsDuplicates(
      [{ url: `https://${HOST}/a`, body }],
      { deps, httpsExceptions: { invalidTls: true } },
    )
    expect(tls.findings[0]?.verdict).toBe('human-review-https-exception')

    // 4. HTTPS canonical points at HTTP → human-review
    const badCanon = await detectHttpHttpsDuplicates(
      [{ url: `https://${HOST}/a`, body }],
      { deps, httpsExceptions: { httpsCanonicalPointsHttp: true } },
    )
    expect(badCanon.findings[0]?.verdict).toBe('human-review-https-exception')

    // 5. different content → suppressed
    const diff = await detectHttpHttpsDuplicates(
      [{ url: `https://${HOST}/diff`, body }],
      { deps },
    )
    expect(
      diff.suppressed.some((s) => s.verdict === 'suppress-different-content'),
    ).toBe(true)
  })
})

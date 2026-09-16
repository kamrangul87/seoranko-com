import { describe, expect, it, vi } from 'vitest'
import { detectPathCaseDuplicates } from '@/lib/fix-strategies/topic-11'
import { classifyDuplicateUrl } from '@/lib/fix-strategies/duplicate-url'

const ORIGIN = 'https://example.com'
const same = '<!doctype html><html><head><title>t</title></head><body><p>Apple product page</p></body></html>'
const other = '<!doctype html><html><head><title>t</title></head><body><p>apple fruit page</p></body></html>'

describe('topic 11 — path case variants', () => {
  it('classifies the dossier fixture set', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input))
      if (u.pathname === '/Apple' && u.search === '') {
        // already redirecting case
        if (u.href.includes('redirect-test')) {
          /* unused */
        }
      }
      if (u.pathname === '/Moved') {
        return new Response(null, {
          status: 301,
          headers: { location: `${ORIGIN}/moved` },
        })
      }
      if (u.pathname === '/Apple') {
        return new Response(same, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      if (u.pathname === '/apple') {
        // default: identical; /Fruit vs /fruit differ
        return new Response(same, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      if (u.pathname === '/Fruit') {
        return new Response(same, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      if (u.pathname === '/fruit') {
        return new Response(other, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      if (u.pathname === '/moved') {
        return new Response(same, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      return new Response('no', { status: 404 })
    })
    const deps = { fetch: fetchMock as unknown as typeof fetch }

    // 1. /Apple and /apple both 200 identical → raised (specific pair)
    const pair = await detectPathCaseDuplicates(
      [{ url: `${ORIGIN}/Apple`, body: same }],
      {
        deps,
        signals: {
          canonicals: [`${ORIGIN}/Apple`],
          sitemapUrls: [`${ORIGIN}/Apple`],
        },
      },
    )
    expect(pair.findings[0]?.verdict).toBe('auto-redirect')
    expect(pair.findings[0]?.urlB).toBe(`${ORIGIN}/apple`)

    // 2. different content → suppressed as case-sensitive server
    const cs = await detectPathCaseDuplicates(
      [{ url: `${ORIGIN}/Fruit`, body: same }],
      { deps },
    )
    expect(
      cs.suppressed.some((s) => s.verdict === 'suppress-different-content'),
    ).toBe(true)
    expect(
      cs.suppressed.find((s) => s.verdict === 'suppress-different-content')
        ?.detail,
    ).toMatch(/case-sensitive/i)

    // 3. already redirecting → suppressed
    const redir = await detectPathCaseDuplicates(
      [{ url: `${ORIGIN}/Moved`, body: same }],
      { deps },
    )
    expect(
      redir.suppressed.some((s) => s.verdict === 'ok-already-normalises'),
    ).toBe(true)

    // 4. uppercase only in query — no path-case variant from all-lower path
    const q = await detectPathCaseDuplicates(
      [{ url: `${ORIGIN}/apple?Token=AbC` }],
      { deps },
    )
    expect(
      q.suppressed.some((s) => s.verdict === 'suppress-not-applicable'),
    ).toBe(true)

    // 5. mixed-case host alone is not path-case (hostname case-insensitive)
    // Covered by variant generator: host lowercased, path without upper → null
  })

  it('REJECTS blanket lowercase proposal', () => {
    const r = classifyDuplicateUrl({
      strategy: 'path-case',
      alreadyRedirects: false,
      contentSame: true,
      isSiteRoot: false,
      preferred: {
        status: 'resolved',
        preferred: `${ORIGIN}/Apple`,
        nonPreferred: `${ORIGIN}/apple`,
        source: 'canonical',
      },
      blanketLowercaseProposed: true,
    })
    expect(r.verdict).toBe('human-review-blast-radius')
    expect(r.detail).toMatch(/REJECTED|blanket/i)
  })
})

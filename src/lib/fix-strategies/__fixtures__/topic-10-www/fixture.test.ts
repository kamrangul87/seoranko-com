import { describe, expect, it, vi } from 'vitest'
import { detectWwwNonWwwDuplicates } from '@/lib/fix-strategies/topic-10'

const body = '<!doctype html><html><head><title>t</title></head><body><p>same host content</p></body></html>'
const appBody = '<!doctype html><html><head><title>app</title></head><body><p>different app</p></body></html>'

describe('topic 10 — www vs non-www duplicates', () => {
  it('classifies the dossier fixture set', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input))
      if (u.hostname === 'www.example.com' && u.pathname === '/redir') {
        return new Response(null, {
          status: 301,
          headers: { location: 'https://example.com/redir' },
        })
      }
      if (u.hostname === 'app.example.com') {
        return new Response(appBody, {
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

    // 1. both hosts 200 identical + derived preference → human-review (blast)
    const both = await detectWwwNonWwwDuplicates(
      [{ url: 'https://example.com/a', body }],
      {
        deps,
        signals: {
          canonicals: ['https://example.com/a'],
          sitemapUrls: ['https://example.com/a'],
        },
      },
    )
    expect(both.findings[0]?.verdict).toBe('human-review-blast-radius')
    expect(both.findings[0]?.preferred).toMatchObject({
      status: 'resolved',
      preferred: 'https://example.com/a',
    })

    // 2. already redirecting → suppressed
    const redir = await detectWwwNonWwwDuplicates(
      [{ url: 'https://example.com/redir', body }],
      { deps },
    )
    expect(
      redir.suppressed.some((s) => s.verdict === 'ok-already-normalises'),
    ).toBe(true)

    // 3. conflicting signals → human-review conflict
    const conflict = await detectWwwNonWwwDuplicates(
      [{ url: 'https://example.com/a', body }],
      {
        deps,
        signals: {
          sitemapUrls: ['https://www.example.com/a'],
          internalLinkUrls: [
            'https://example.com/a',
            'https://example.com/a',
          ],
        },
      },
    )
    expect(conflict.findings[0]?.verdict).toBe(
      'human-review-preferred-conflict',
    )

    // 4. different content (separate app) — www of example vs would be www.example
    // For a true subdomain app, content differs when we flip www — covered:
    const sep = await detectWwwNonWwwDuplicates(
      [{ url: 'https://example.com/a', body: appBody }],
      {
        deps: {
          fetch: vi.fn(async (input: RequestInfo | URL) => {
            const u = new URL(String(input))
            if (u.hostname === 'www.example.com') {
              return new Response(body, {
                status: 200,
                headers: { 'content-type': 'text/html' },
              })
            }
            return new Response(appBody, {
              status: 200,
              headers: { 'content-type': 'text/html' },
            })
          }) as unknown as typeof fetch,
        },
      },
    )
    expect(
      sep.suppressed.some((s) => s.verdict === 'suppress-different-content'),
    ).toBe(true)
  })
})

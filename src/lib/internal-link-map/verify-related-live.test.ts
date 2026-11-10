import { describe, expect, it, vi } from 'vitest'
import {
  verifyRelatedLinksInHtml,
  verifyRelatedFindingLive,
  summarizeRelatedVerify,
} from './verify-related-live'

const PAGE = 'https://example.com/blog/ev-charging-reliability-uk.html'
const TARGET_HREF = '/blog/mot-history-check-uk.html'
const TARGET_URL = 'https://example.com/blog/mot-history-check-uk.html'

const GOOD_HTML = `<!doctype html><html><body>
<main>
  <article>
    <h1>EV charging reliability</h1>
    <p>Guide for drivers.</p>
    <nav class="related-articles">
      <h3>Related</h3>
      <a href="/blog/mot-history-check-uk.html">How to check a vehicle MOT history</a>
    </nav>
  </article>
</main>
<footer><a href="/privacy">Privacy</a></footer>
</body></html>`

describe('verifyRelatedLinksInHtml', () => {
  it('passes a descriptive in-article related link', () => {
    const result = verifyRelatedLinksInHtml({
      html: GOOD_HTML,
      pageUrl: PAGE,
      targets: [{ href: TARGET_HREF, anchorText: 'How to check a vehicle MOT history' }],
    })
    expect(result.links).toHaveLength(1)
    expect(result.links[0]).toMatchObject({
      href: TARGET_HREF,
      ok: true,
      inContent: true,
      emptyAnchor: false,
      genericAnchor: false,
      duplicate: false,
      nofollow: false,
    })
  })

  it('fails footer-only, empty, generic, duplicate, and nofollow links', () => {
    const html = `<!doctype html><html><body>
<main><article><h1>Guide</h1><p>Body copy.</p></article></main>
<footer>
  <a href="/blog/mot-history-check-uk.html" rel="nofollow"></a>
  <a href="/blog/mot-history-check-uk.html">click here</a>
</footer>
</body></html>`
    const result = verifyRelatedLinksInHtml({
      html,
      pageUrl: PAGE,
      targets: [{ href: TARGET_HREF, anchorText: 'MOT history' }],
    })
    const link = result.links[0]!
    expect(link.ok).toBe(false)
    expect(link.inContent).toBe(false)
    expect(link.duplicate).toBe(true)
    expect(link.nofollow).toBe(true)
    expect(link.genericAnchor).toBe(true)
    expect(link.emptyAnchor).toBe(true)
    expect(link.problems.length).toBeGreaterThan(0)
  })

  it('fails a link that sits after </body>', () => {
    const html = `<!doctype html><html><body>
<main><article><h1>Guide</h1></article></main>
</body>
<a href="/blog/mot-history-check-uk.html">MOT history check</a>
</html>`
    const result = verifyRelatedLinksInHtml({
      html,
      pageUrl: PAGE,
      targets: [{ href: TARGET_HREF, anchorText: 'MOT history check' }],
    })
    expect(result.links[0]?.inContent).toBe(false)
    expect(result.links[0]?.ok).toBe(false)
    expect(result.links[0]?.problems.join(' ')).toMatch(/article|main|footer|body/i)
  })
})

describe('verifyRelatedFindingLive', () => {
  it('records per-link pass when the target returns 200 without a redirect hop', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === PAGE) {
        return new Response(GOOD_HTML, { status: 200 })
      }
      if (url === TARGET_URL || url.endsWith(TARGET_HREF)) {
        return new Response('ok', { status: 200 })
      }
      return new Response('missing', { status: 404 })
    }) as unknown as typeof fetch

    const result = await verifyRelatedFindingLive({
      pageUrl: PAGE,
      targets: [{ href: TARGET_HREF, anchorText: 'How to check a vehicle MOT history' }],
      fetchImpl,
    })
    expect(result.ok).toBe(true)
    expect(result.links[0]).toMatchObject({
      ok: true,
      targetStatus: 200,
      targetRedirected: false,
    })
    expect(summarizeRelatedVerify(result)).toBe('verified')
  })

  it('flags a 301 target even if the final URL would be fine', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === PAGE) {
        return new Response(GOOD_HTML, { status: 200 })
      }
      if (init?.redirect === 'manual' || init?.redirect === 'error') {
        return new Response('', {
          status: 301,
          headers: { location: '/blog/mot-history-check-uk/' },
        })
      }
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const result = await verifyRelatedFindingLive({
      pageUrl: PAGE,
      targets: [{ href: TARGET_HREF, anchorText: 'How to check a vehicle MOT history' }],
      fetchImpl,
    })
    expect(result.ok).toBe(false)
    expect(result.links[0]?.targetRedirected).toBe(true)
    expect(result.links[0]?.ok).toBe(false)
    expect(summarizeRelatedVerify(result)).toBe('problem')
  })
})

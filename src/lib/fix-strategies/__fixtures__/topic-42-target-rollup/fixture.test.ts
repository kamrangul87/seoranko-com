import { describe, expect, it, vi } from 'vitest'
import { detectLinksThroughRedirects } from '@/lib/fix-strategies/topic-42'
import type { FetchDeps } from '@/lib/fix-strategies/fetch'

const HOST = 'https://wp.example'

/**
 * Detect-only WordPress: every page's menu links to /checkout/ which 302s.
 * Without target-based grouping + declarationSite, rollup keyed on pageUrl
 * and produced one finding per page (minso: 9× temporary-redirect).
 */
describe('topic 42 — sitewide temporary redirect rolls up to one finding', () => {
  it('collapses identical temporary-redirect targets across pages', async () => {
    const pages = [
      `${HOST}/`,
      `${HOST}/shop/`,
      `${HOST}/sample-page/`,
      `${HOST}/hello-world/`,
    ].map((url) => ({
      url,
      html: `<!doctype html><html><body>
<nav><a href="${HOST}/checkout/">Checkout</a><a href="${HOST}/shop/">Shop</a></nav>
<p>Content on ${url}</p>
</body></html>`,
    }))

    const deps: FetchDeps = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/checkout')) {
          return new Response(null, {
            status: 302,
            headers: { location: `${HOST}/cart/` },
          })
        }
        return new Response('<html><body>ok</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }) as typeof fetch,
      now: () => Date.now(),
      sleep: async () => {},
    }

    const result = await detectLinksThroughRedirects(pages, { deps })
    const temp = result.findings.filter(
      (f) => f.verdict === 'human-review-temporary-redirect',
    )
    expect(temp).toHaveLength(1)
    expect(temp[0]!.observedOn.length).toBe(4)
    expect(temp[0]!.declarationSite).toBe(
      `redirect-target:${HOST}/checkout/`,
    )
    expect(temp[0]!.detail).toMatch(/4 pages/)
    expect(temp[0]!.detail).toMatch(/one redirect rule/)
  })
})

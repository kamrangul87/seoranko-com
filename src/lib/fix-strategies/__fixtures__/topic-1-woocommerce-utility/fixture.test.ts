import { describe, expect, it, vi } from 'vitest'
import {
  detectBrokenInternalLinks,
  isDeliberateNoindexUtilityPath,
} from '@/lib/fix-strategies/topic-1/detect'
import type { FetchDeps } from '@/lib/fix-strategies/fetch'

const HOST = 'https://store.example'

function htmlLinking(paths: string[]): string {
  const anchors = paths.map((p) => `<a href="${p}">${p}</a>`).join(' ')
  return `<!doctype html><html><body>${anchors}<p>Home</p></body></html>`
}

function noindexPage(title: string): string {
  return `<!doctype html><html><head>
<meta name="robots" content="noindex, follow" />
<title>${title}</title></head><body><h1>${title}</h1><p>WooCommerce utility</p></body></html>`
}

describe('topic 1 — WooCommerce deliberate noindex utility paths', () => {
  it('recognises standard cart/checkout/my-account paths', () => {
    expect(isDeliberateNoindexUtilityPath('/cart/')).toBe(true)
    expect(isDeliberateNoindexUtilityPath('/checkout')).toBe(true)
    expect(isDeliberateNoindexUtilityPath('/my-account/lost-password/')).toBe(
      true,
    )
    expect(isDeliberateNoindexUtilityPath('/shop/')).toBe(false)
    expect(isDeliberateNoindexUtilityPath('/hello-world/')).toBe(false)
  })

  it('suppresses 200+noindex on utility routes without a connected repo', async () => {
    // Live minso outcomes: cart/my-account = 200 + meta noindex; checkout = 302.
    const deps: FetchDeps = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/checkout')) {
          return new Response(null, {
            status: 302,
            headers: { location: `${HOST}/cart/` },
          })
        }
        if (
          url.includes('/cart') ||
          url.includes('/my-account')
        ) {
          const title = url.includes('lost-password')
            ? 'Lost password'
            : url.includes('cart')
              ? 'Cart'
              : 'My account'
          return new Response(noindexPage(title), {
            status: 200,
            headers: { 'content-type': 'text/html' },
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

    const result = await detectBrokenInternalLinks(
      htmlLinking([
        `${HOST}/cart/`,
        `${HOST}/checkout/`,
        `${HOST}/my-account/`,
        `${HOST}/my-account/lost-password/`,
        `${HOST}/shop/`,
      ]),
      `${HOST}/`,
      { deps }, // no repoRoot — detect-only path that previously raised soft-404
    )

    expect(
      result.findings.filter((f) => f.kind === 'broken-internal-link/soft-404'),
    ).toHaveLength(0)
    expect(
      result.suppressed.filter((s) => s.reason === 'deliberate-utility-noindex'),
    ).toHaveLength(3) // cart, my-account, lost-password
    expect(
      result.suppressed.some(
        (s) => s.href.includes('/checkout') && s.reason.startsWith('status-'),
      ),
    ).toBe(true)
  })
})

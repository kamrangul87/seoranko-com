import { describe, expect, it, vi } from 'vitest'
import {
  detectGoneAnchors,
  removeAnchorByHref,
  verifyAnchorAbsent,
} from '@/lib/fix-strategies/topic-1'
import type { FetchDeps } from '@/lib/fix-strategies/fetch'
import {
  FIXTURE_HOST,
  GONE_PATH,
  SOURCE_PATH,
  fixtureResponses,
  sourcePageHtml,
} from './pages'

/**
 * Minimal in-process "live" surface — no customer repo writes.
 * Serves fixture paths with the statuses the dossier names for this slice.
 */
function createFixtureFetch(overrides?: Record<string, string>): FetchDeps {
  const pages = fixtureResponses()
  return {
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      // Allow the source page body to be swapped after the fix is applied,
      // so the verifier asserts against a "served" response.
      if (overrides?.[url.pathname] != null) {
        return new Response(overrides[url.pathname], { status: 200 })
      }
      const page = pages[url.pathname]
      if (!page) return new Response('not found', { status: 404 })
      return new Response(page.body, { status: page.status })
    }) as unknown as typeof fetch,
    sleep: vi.fn(async () => {}),
    now: () => 0,
    config: {
      fallbackDelayMs: 1,
      maxAttempts: 2,
      maxRetryAfterMs: 10,
      timeoutMs: 200,
    },
  }
}

describe('topic-1 fixture (410 slice)', () => {
  it('raises one finding, suppresses three, applies fix, passes postcondition on served HTML', async () => {
    const sourceUrl = `${FIXTURE_HOST}${SOURCE_PATH}`
    const originalHtml = sourcePageHtml()
    const deps = createFixtureFetch()

    // Detect against live target statuses.
    const detected = await detectGoneAnchors(originalHtml, sourceUrl, deps)

    expect(detected.findings).toHaveLength(1)
    expect(detected.findings[0]?.href).toBe(GONE_PATH)
    expect(detected.findings[0]?.targetUrl).toBe(`${FIXTURE_HOST}${GONE_PATH}`)

    const schemeSuppressed = detected.suppressed.filter(
      (s) => s.reason === 'scheme-filter',
    )
    expect(schemeSuppressed.map((s) => s.href).sort()).toEqual([
      '#',
      'mailto:hello@fixture.test',
    ])
    expect(
      detected.suppressed.some(
        (s) => s.href === '/healthy' && s.reason === 'healthy-200',
      ),
    ).toBe(true)

    // Three suppressed outcomes: mailto, #, healthy (external not present).
    const suppressedHrefs = new Set(detected.suppressed.map((s) => s.href))
    expect(suppressedHrefs.has('mailto:hello@fixture.test')).toBe(true)
    expect(suppressedHrefs.has('#')).toBe(true)
    expect(suppressedHrefs.has('/healthy')).toBe(true)

    // Apply fix in memory (fixtures only — no customer repo write).
    const finding = detected.findings[0]!
    const fixed = removeAnchorByHref(originalHtml, finding.href)
    expect(fixed.removed).toBe(1)

    // "Serve" the fixed HTML as the live source response and verify.
    const liveDeps = createFixtureFetch({
      [SOURCE_PATH]: fixed.html,
    })
    const liveResponse = await liveDeps.fetch(sourceUrl)
    const liveHtml = await liveResponse.text()

    const post = verifyAnchorAbsent(liveHtml, finding.href)
    expect(post.ok).toBe(true)
    expect(liveHtml).toContain('href="/healthy"')
    expect(liveHtml).not.toContain(`href="${GONE_PATH}"`)
  })
})

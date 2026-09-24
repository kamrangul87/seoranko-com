import { describe, expect, it, vi } from 'vitest'
import {
  extractInternalFetchableAnchors,
  isSkippableHref,
} from './extract-anchors'
import { detectGoneAnchors } from './detect-410'
import { detectGoneAnchorsFromFetch } from './detect-from-fetch'
import { removeAnchorByHref } from './fix-remove-anchor'
import { verifyAnchorAbsent } from './verify-anchor-absent'
import type { FetchDeps, FetchOutcome } from '@/lib/fix-strategies/fetch'
import fs from 'node:fs'
import path from 'node:path'

const PAGE_URL = 'https://example.com/posts/a'

function htmlFixture(): string {
  return `<!doctype html><html><body>
    <a href="/gone-page">Gone</a>
    <a href="mailto:hello@example.com">Email</a>
    <a href="#">Top</a>
    <a href="/healthy">Healthy</a>
  </body></html>`
}

function depsWithStatus(map: Record<string, number>): FetchDeps {
  return {
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const pathname = new URL(url).pathname
      const status = map[pathname] ?? 200
      return new Response(`status-${status}`, { status })
    }) as unknown as typeof fetch,
    sleep: vi.fn(async () => {}),
    now: () => 0,
    config: {
      fallbackDelayMs: 1,
      maxAttempts: 2,
      maxRetryAfterMs: 10,
      timeoutMs: 100,
    },
  }
}

describe('scheme filter', () => {
  it('skips mailto, hash, javascript, tel', () => {
    expect(isSkippableHref('mailto:a@b.c')).toBe(true)
    expect(isSkippableHref('#')).toBe(true)
    expect(isSkippableHref('#section')).toBe(true)
    expect(isSkippableHref('tel:+123')).toBe(true)
    expect(isSkippableHref('javascript:void(0)')).toBe(true)
    expect(isSkippableHref('/path')).toBe(false)
  })
})

describe('extractInternalFetchableAnchors', () => {
  it('keeps only internal fetchable hrefs', () => {
    const anchors = extractInternalFetchableAnchors(htmlFixture(), PAGE_URL)
    expect(anchors.map((a) => a.href).sort()).toEqual([
      '/gone-page',
      '/healthy',
    ])
  })
})

describe('detectGoneAnchors (410 branch)', () => {
  it('raises only for 410 targets', async () => {
    const deps = depsWithStatus({
      '/gone-page': 410,
      '/healthy': 200,
    })
    const result = await detectGoneAnchors(htmlFixture(), PAGE_URL, deps)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.targetUrl).toBe('https://example.com/gone-page')
    expect(result.findings[0]?.kind).toBe('broken-internal-link/410')

    const reasons = result.suppressed.map((s) => s.reason)
    expect(reasons).toContain('scheme-filter')
    expect(reasons).toContain('healthy-200')
  })
})

describe('detectGoneAnchorsFromFetch (topic 67 gate)', () => {
  it('refuses when source streamComplete is false — does not parse anchors', async () => {
    const deps = depsWithStatus({ '/gone-page': 410 })
    const incomplete: FetchOutcome = {
      kind: 'http',
      status: 200,
      statusClass: '2xx',
      headers: new Headers(),
      body: htmlFixture(),
      url: PAGE_URL,
      streamComplete: false,
      observedAtMs: 0,
    }
    const result = await detectGoneAnchorsFromFetch(incomplete, PAGE_URL, deps)
    expect(result.refused).toBe(true)
    if (result.refused) expect(result.reason).toBe('stream_incomplete')
    expect(deps.fetch).not.toHaveBeenCalled()
  })
})

describe('remove + verify separation', () => {
  it('fixer removes the anchor and verifier confirms against HTML', () => {
    const original = htmlFixture()
    const { html, removed } = removeAnchorByHref(original, '/gone-page')
    expect(removed).toBe(1)
    expect(html).not.toContain('href="/gone-page"')
    expect(html).toContain('href="/healthy"')

    expect(verifyAnchorAbsent(html, '/gone-page').ok).toBe(true)
    expect(verifyAnchorAbsent(original, '/gone-page').ok).toBe(false)
  })

  it('verifier module does not import the fixer', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'verify-anchor-absent.ts'),
      'utf8',
    )
    expect(source).not.toMatch(/fix-remove-anchor/)
    expect(source).not.toMatch(/removeAnchorByHref/)
  })
})

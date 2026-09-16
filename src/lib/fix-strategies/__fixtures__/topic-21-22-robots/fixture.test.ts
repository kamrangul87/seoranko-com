import { describe, expect, it, vi } from 'vitest'
import {
  detectRobotsTxtIssues,
  inspectRobotsTxtBody,
  removeCrawlDelayLines,
  proposeTextPlainHeader,
  rejectedDisallowEdit,
  rejectedCreateRobotsTxt,
} from '@/lib/fix-strategies/topic-22'
import { detectBlockedRenderResources } from '@/lib/fix-strategies/topic-21'
import { ROBOTS_TXT_MAX_BYTES } from '@/lib/fix-strategies/shared'

describe('topic 22 — robots.txt invalid or unreachable', () => {
  it('classifies the dossier fixture set', async () => {
    // 1. 5xx twice → critical
    const fiveXx = vi.fn(async () => new Response('err', { status: 503 }))
    const r5 = await detectRobotsTxtIssues({
      originUrl: 'https://example.com',
      deps: { fetch: fiveXx as unknown as typeof fetch },
    })
    expect(r5.findings.some((f) => f.verdict === 'critical-5xx-complete-disallow')).toBe(
      true,
    )
    expect(r5.findings.find((f) => f.verdict === 'critical-5xx-complete-disallow')?.severity).toBe(
      'critical',
    )
    expect(fiveXx).toHaveBeenCalledTimes(2)

    // 2. 404 → suppress (normal) — most likely false positive if raised as defect
    const r404 = await detectRobotsTxtIssues({
      originUrl: 'https://example.com',
      deps: {
        fetch: vi.fn(async () => new Response('missing', { status: 404 })) as unknown as typeof fetch,
      },
    })
    expect(r404.findings.some((f) => f.verdict === 'suppress-404-normal')).toBe(
      true,
    )
    expect(r404.inspection.fetchStatus).toBe('not-found')
    // Not an actionable defect
    expect(
      r404.findings.filter(
        (f) => f.verdict !== 'suppress-404-normal' && f.verdict !== 'ok',
      ),
    ).toHaveLength(0)

    // 3. text/html → auto-set-text-plain
    const htmlCt = inspectRobotsTxtBody('User-agent: *\nDisallow:\n', {
      url: 'https://example.com/robots.txt',
      status: 200,
      contentType: 'text/html',
      fetchStatus: 'ok',
    })
    const rHtml = await detectRobotsTxtIssues({
      originUrl: 'https://example.com',
      deps: { fetch: vi.fn() as unknown as typeof fetch },
      inspection: htmlCt,
    })
    expect(rHtml.findings.some((f) => f.verdict === 'auto-set-text-plain')).toBe(
      true,
    )
    expect(
      rHtml.findings.find((f) => f.verdict === 'auto-set-text-plain')?.autoFixable,
    ).toBe(true)

    // 4. noindex: in robots → human-review (paired proposal, not auto)
    const withNoindex = inspectRobotsTxtBody(
      'User-agent: *\nnoindex: /private\nDisallow:\n',
      {
        url: 'https://example.com/robots.txt',
        status: 200,
        contentType: 'text/plain',
        fetchStatus: 'ok',
      },
    )
    const rNi = await detectRobotsTxtIssues({
      originUrl: 'https://example.com',
      deps: { fetch: vi.fn() as unknown as typeof fetch },
      inspection: withNoindex,
    })
    expect(
      rNi.findings.some((f) => f.verdict === 'human-review-noindex-in-robots'),
    ).toBe(true)
    expect(
      rNi.findings.find((f) => f.verdict === 'human-review-noindex-in-robots')
        ?.autoFixable,
    ).toBe(false)

    // 5. crawl-delay → auto-remove
    const withCd = inspectRobotsTxtBody(
      'User-agent: *\nCrawl-delay: 10\nDisallow:\n',
      {
        url: 'https://example.com/robots.txt',
        status: 200,
        contentType: 'text/plain',
        fetchStatus: 'ok',
      },
    )
    const rCd = await detectRobotsTxtIssues({
      originUrl: 'https://example.com',
      deps: { fetch: vi.fn() as unknown as typeof fetch },
      inspection: withCd,
    })
    expect(rCd.findings.some((f) => f.verdict === 'auto-remove-crawl-delay')).toBe(
      true,
    )

    // 6. 600 KiB → size limit
    const big = 'User-agent: *\n' + 'Disallow: /x\n'.repeat(80_000)
    expect(big.length).toBeGreaterThan(ROBOTS_TXT_MAX_BYTES)
    const rBig = await detectRobotsTxtIssues({
      originUrl: 'https://example.com',
      deps: { fetch: vi.fn() as unknown as typeof fetch },
      inspection: inspectRobotsTxtBody(big, {
        url: 'https://example.com/robots.txt',
        status: 200,
        contentType: 'text/plain',
        fetchStatus: 'ok',
      }),
    })
    expect(rBig.findings.some((f) => f.verdict === 'human-review-size-limit')).toBe(
      true,
    )

    // 7. malformed line
    const mal = inspectRobotsTxtBody('User-agent: *\nThis is not a rule\nDisallow:\n', {
      url: 'https://example.com/robots.txt',
      status: 200,
      contentType: 'text/plain',
      fetchStatus: 'ok',
    })
    const rMal = await detectRobotsTxtIssues({
      originUrl: 'https://example.com',
      deps: { fetch: vi.fn() as unknown as typeof fetch },
      inspection: mal,
    })
    expect(rMal.findings.some((f) => f.verdict === 'human-review-malformed')).toBe(
      true,
    )

    // 8. valid minimal → nothing actionable
    const ok = inspectRobotsTxtBody('User-agent: *\nDisallow:\n', {
      url: 'https://example.com/robots.txt',
      status: 200,
      contentType: 'text/plain',
      fetchStatus: 'ok',
    })
    const rOk = await detectRobotsTxtIssues({
      originUrl: 'https://example.com',
      deps: { fetch: vi.fn() as unknown as typeof fetch },
      inspection: ok,
    })
    expect(rOk.findings.filter((f) => f.verdict !== 'ok')).toHaveLength(0)
  })

  it('rejects Disallow edits and creating robots.txt; fixers are permission no-ops', () => {
    expect(() => rejectedDisallowEdit()).toThrow(/REJECTED/)
    expect(() => rejectedCreateRobotsTxt()).toThrow(/REJECTED/)
    const { body, removed } = removeCrawlDelayLines(
      'User-agent: *\nCrawl-delay: 10\nDisallow:\n',
    )
    expect(removed).toBe(1)
    expect(body).not.toMatch(/crawl-delay/i)
    expect(proposeTextPlainHeader('module.exports = {}').updated).toBe(true)
  })
})

describe('topic 21 — blocking CSS/JS (uses topic 22 inspection)', () => {
  it('classifies the dossier fixture set — report first only', () => {
    const robots = `User-agent: *
Disallow: /blocked.css
Disallow: /blocked.js
Allow: /allowed.css
Disallow: /allowed.css
Disallow: /analytics.js

User-agent: Bingbot
Disallow: /bing-only.css
`
    const inspection = inspectRobotsTxtBody(robots, {
      url: 'https://example.com/robots.txt',
      status: 200,
      contentType: 'text/plain',
      fetchStatus: 'ok',
    })

    // Feed same inspection — topic 21 does not re-parse
    const result = detectBlockedRenderResources(
      [
        {
          url: 'https://example.com/page',
          indexable: true,
          html: `<!doctype html><html><head>
            <link rel="stylesheet" href="/blocked.css">
            <link rel="stylesheet" href="/allowed.css">
            <script src="https://cdn.example.net/x.js"></script>
            <script src="/analytics.js"></script>
            <link rel="stylesheet" href="/bing-only.css">
          </head><body></body></html>`,
        },
        {
          // JS blocked but referenced only by noindex page → suppress
          url: 'https://example.com/private',
          indexable: false,
          html: `<!doctype html><html><head>
            <meta name="robots" content="noindex">
            <script src="/blocked.js"></script>
          </head><body></body></html>`,
        },
      ],
      inspection,
    )

    // Dossier: reported for the first (blocked.css) only
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.resourceUrl).toContain('/blocked.css')
    expect(result.findings[0]?.materialityAsserted).toBe(false)

    // blocked.js — only non-indexable referrer
    expect(
      result.suppressed.some(
        (s) =>
          s.resourceUrl.includes('/blocked.js') &&
          s.verdict === 'suppress-non-indexable-referrer',
      ),
    ).toBe(true)

    // allowed.css — Allow wins equal length
    expect(
      result.suppressed.some(
        (s) =>
          s.resourceUrl.includes('/allowed.css') &&
          s.verdict === 'suppress-allowed-by-allow-rule',
      ),
    ).toBe(true)

    // cross-origin
    expect(
      result.suppressed.some((s) => s.verdict === 'suppress-cross-origin'),
    ).toBe(true)

    // analytics
    expect(
      result.suppressed.some(
        (s) =>
          s.resourceUrl.includes('/analytics.js') &&
          s.verdict === 'suppress-analytics',
      ),
    ).toBe(true)

    // bing-only — Googlebot uses * group which does not disallow it
    expect(
      result.suppressed.some(
        (s) =>
          s.resourceUrl.includes('/bing-only.css') &&
          s.verdict === 'suppress-allowed-by-allow-rule',
      ),
    ).toBe(true)
  })

  it('5xx robots inspection assumes complete disallow for resources', () => {
    const inspection = inspectRobotsTxtBody('', {
      url: 'https://example.com/robots.txt',
      status: 503,
      contentType: null,
      fetchStatus: 'server-error',
    })
    const result = detectBlockedRenderResources(
      [
        {
          url: 'https://example.com/page',
          indexable: true,
          html: `<!doctype html><html><head>
            <link rel="stylesheet" href="/app.css">
          </head><body></body></html>`,
        },
      ],
      inspection,
    )
    expect(result.findings.some((f) => f.resourceUrl.includes('/app.css'))).toBe(
      true,
    )
  })

  it('404 robots inspection permits resources (R20)', () => {
    const inspection = inspectRobotsTxtBody('', {
      url: 'https://example.com/robots.txt',
      status: 404,
      contentType: null,
      fetchStatus: 'not-found',
    })
    const result = detectBlockedRenderResources(
      [
        {
          url: 'https://example.com/page',
          indexable: true,
          html: `<!doctype html><html><head>
            <link rel="stylesheet" href="/app.css">
          </head><body></body></html>`,
        },
      ],
      inspection,
    )
    expect(result.findings).toHaveLength(0)
    expect(
      result.suppressed.some((s) => s.verdict === 'suppress-allowed-by-allow-rule'),
    ).toBe(true)
  })
})

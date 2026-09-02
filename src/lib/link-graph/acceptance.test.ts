/**
 * Acceptance tests — spec §8. Write these first; implementation must satisfy them.
 */

import { describe, expect, it } from 'vitest'
import { runLinkGraphAudit } from './run'
import { normalizeLinkUrl } from './normalize'
import { buildFixList } from './fix-list'
import { assertReportOnlyUsesComputedRules, buildTopCauses, buildVerdictHeadline } from './score'
import type { LinkGraphInput } from './types'
import type { TargetFetcher } from './resolve-targets'

function baseInput(overrides: Partial<LinkGraphInput> = {}): LinkGraphInput {
  return {
    seedUrl: 'https://example.com/',
    siteHost: 'example.com',
    htmlByUrl: {},
    pages: [],
    sitemapUrls: [],
    robotsTxt: 'User-agent: *\nAllow: /',
    ...overrides,
  }
}

/** Mock fetcher driven by a URL → {status, location?} map. */
function mockFetcher(map: Record<string, { status: number; location?: string }>): TargetFetcher {
  return async (url) => {
    const row = map[url]
    if (!row) return { status: 404, location: null, finalRequestUrl: url }
    return { status: row.status, location: row.location || null, finalRequestUrl: url }
  }
}

describe('link-graph acceptance (§8)', () => {
  it('1. page linked only via 302 produces exactly one L05 with suggested_href = final URL', async () => {
    const html = {
      'https://example.com/': `<html><body><main><a href="/old">Go</a></main></body></html>`,
    }
    const result = await runLinkGraphAudit(
      baseInput({
        htmlByUrl: html,
        pages: [
          { url: 'https://example.com/', httpStatus: 200, crawlDepth: 0, verdict: 'INDEXABLE', steps: [] },
          { url: 'https://example.com/new', httpStatus: 200, crawlDepth: 1, verdict: 'INDEXABLE', steps: [] },
        ],
      }),
      {
        fetcher: mockFetcher({
          'https://example.com/old': { status: 302, location: 'https://example.com/new' },
          'https://example.com/new': { status: 200 },
          'https://example.com/': { status: 200 },
        }),
      },
    )
    const l05 = result.findings.filter((f) => f.ruleId === 'L05')
    expect(l05).toHaveLength(1)
    expect(l05[0]!.suggestedTarget).toBe('https://example.com/new')
    expect(result.findings.filter((f) => f.ruleId === 'L04')).toHaveLength(0)
  })

  it('2. 3-hop chain produces L04, not three separate L05s', async () => {
    const html = {
      'https://example.com/': `<html><body><main><a href="/a">A</a></main></body></html>`,
    }
    const result = await runLinkGraphAudit(
      baseInput({
        htmlByUrl: html,
        pages: [{ url: 'https://example.com/', httpStatus: 200, crawlDepth: 0, verdict: 'INDEXABLE', steps: [] }],
      }),
      {
        fetcher: mockFetcher({
          'https://example.com/a': { status: 301, location: 'https://example.com/b' },
          'https://example.com/b': { status: 301, location: 'https://example.com/c' },
          'https://example.com/c': { status: 200 },
          'https://example.com/': { status: 200 },
        }),
      },
    )
    expect(result.findings.filter((f) => f.ruleId === 'L04').length).toBeGreaterThanOrEqual(1)
    expect(result.findings.filter((f) => f.ruleId === 'L05')).toHaveLength(0)
    expect(result.findings.find((f) => f.ruleId === 'L04')!.suggestedTarget).toBe('https://example.com/c')
  })

  it('3. A → B → A produces L03 once and does not hang', async () => {
    const html = {
      'https://example.com/': `<html><body><main><a href="/loop-a">Loop</a></main></body></html>`,
    }
    const result = await runLinkGraphAudit(
      baseInput({
        htmlByUrl: html,
        pages: [{ url: 'https://example.com/', httpStatus: 200, crawlDepth: 0, verdict: 'INDEXABLE', steps: [] }],
      }),
      {
        fetcher: mockFetcher({
          'https://example.com/loop-a': { status: 301, location: 'https://example.com/loop-b' },
          'https://example.com/loop-b': { status: 301, location: 'https://example.com/loop-a' },
          'https://example.com/': { status: 200 },
        }),
      },
    )
    expect(result.findings.filter((f) => f.ruleId === 'L03')).toHaveLength(1)
  })

  it('4. utm link and clean link produce one link_targets row', async () => {
    const html = {
      'https://example.com/': `<html><body><main>
        <a href="/page?utm_source=x">One</a>
        <a href="/page">Two</a>
      </main></body></html>`,
    }
    const result = await runLinkGraphAudit(
      baseInput({
        htmlByUrl: html,
        pages: [
          { url: 'https://example.com/', httpStatus: 200, crawlDepth: 0, verdict: 'INDEXABLE', steps: [] },
          { url: 'https://example.com/page', httpStatus: 200, crawlDepth: 1, verdict: 'INDEXABLE', steps: [] },
        ],
      }),
      {
        fetcher: mockFetcher({
          'https://example.com/page': { status: 200 },
          'https://example.com/': { status: 200 },
        }),
      },
    )
    const pageTargets = result.targets.filter((t) => t.urlNormalized.includes('/page'))
    expect(pageTargets).toHaveLength(1)
    expect(normalizeLinkUrl('https://example.com/page?utm_source=x')).toBe(
      normalizeLinkUrl('https://example.com/page'),
    )
  })

  it('5. site using trailing slashes throughout produces zero L18', async () => {
    const html = {
      'https://example.com/': `<html><body><main><a href="/about/">About</a></main></body></html>`,
      'https://example.com/about/': `<html><body><main><a href="/">Home</a></main></body></html>`,
    }
    const result = await runLinkGraphAudit(
      baseInput({
        htmlByUrl: html,
        pages: [
          {
            url: 'https://example.com/',
            httpStatus: 200,
            crawlDepth: 0,
            verdict: 'INDEXABLE',
            steps: [{ step: 'canonical', passed: true, evidence: 'Canonical self-reference: https://example.com/' }],
          },
          {
            url: 'https://example.com/about/',
            httpStatus: 200,
            crawlDepth: 1,
            verdict: 'INDEXABLE',
            steps: [
              { step: 'canonical', passed: true, evidence: 'Canonical self-reference: https://example.com/about/' },
            ],
          },
        ],
      }),
      {
        fetcher: mockFetcher({
          'https://example.com/': { status: 200 },
          'https://example.com/about/': { status: 200 },
        }),
      },
    )
    expect(result.trailingSlashConvention).toBe(true)
    expect(result.findings.filter((f) => f.ruleId === 'L18')).toHaveLength(0)
  })

  it('6. nav link repeated on many pages produces zero L14/L15/L16', async () => {
    const htmlByUrl: Record<string, string> = {}
    const pages: LinkGraphInput['pages'] = []
    for (let i = 0; i < 30; i++) {
      const url = `https://example.com/p/${i}`
      htmlByUrl[url] =
        `<html><body><nav><a href="/about">About</a></nav><main><p>Content ${i}</p><a href="/related-${i}">Related ${i}</a></main></body></html>`
      pages.push({ url, httpStatus: 200, crawlDepth: 1, verdict: 'INDEXABLE', steps: [] })
    }
    htmlByUrl['https://example.com/about'] = `<html><body><main><p>About</p></main></body></html>`
    pages.push({
      url: 'https://example.com/about',
      httpStatus: 200,
      crawlDepth: 1,
      verdict: 'INDEXABLE',
      steps: [],
    })

    const map: Record<string, { status: number; location?: string }> = {
      'https://example.com/about': { status: 200 },
    }
    for (let i = 0; i < 30; i++) {
      map[`https://example.com/p/${i}`] = { status: 200 }
      map[`https://example.com/related-${i}`] = { status: 200 }
    }

    const result = await runLinkGraphAudit(baseInput({ htmlByUrl, pages }), {
      fetcher: mockFetcher(map),
    })
    expect(result.findings.filter((f) => f.ruleId === 'L14')).toHaveLength(0)
    expect(result.findings.filter((f) => f.ruleId === 'L15')).toHaveLength(0)
    expect(result.findings.filter((f) => f.ruleId === 'L16')).toHaveLength(0)
  })

  it('7. page in sitemap with no inbound anchors produces L21 once', async () => {
    const html = {
      'https://example.com/': `<html><body><main><a href="/linked">Linked</a></main></body></html>`,
      'https://example.com/linked': `<html><body><main><p>ok</p></main></body></html>`,
      'https://example.com/orphan': `<html><body><main><p>orphan</p></main></body></html>`,
    }
    const result = await runLinkGraphAudit(
      baseInput({
        htmlByUrl: html,
        sitemapUrls: ['https://example.com/', 'https://example.com/linked', 'https://example.com/orphan'],
        pages: [
          { url: 'https://example.com/', httpStatus: 200, crawlDepth: 0, verdict: 'INDEXABLE', steps: [] },
          { url: 'https://example.com/linked', httpStatus: 200, crawlDepth: 1, verdict: 'INDEXABLE', steps: [] },
          { url: 'https://example.com/orphan', httpStatus: 200, crawlDepth: 1, verdict: 'INDEXABLE', steps: [] },
        ],
      }),
      {
        fetcher: mockFetcher({
          'https://example.com/': { status: 200 },
          'https://example.com/linked': { status: 200 },
          'https://example.com/orphan': { status: 200 },
        }),
      },
    )
    const orphans = result.findings.filter(
      (f) => f.ruleId === 'L21' && f.targetUrl?.includes('/orphan'),
    )
    expect(orphans).toHaveLength(1)
  })

  it('8. SPA fixture raises L00_JS_SUSPECTED and suppresses L21 and L23', async () => {
    const spaHtml = `<html><body><div id="root">${'x'.repeat(300)}</div></body></html>`
    const result = await runLinkGraphAudit(
      baseInput({
        htmlByUrl: { 'https://example.com/': spaHtml },
        pages: [
          { url: 'https://example.com/', httpStatus: 200, crawlDepth: 0, verdict: 'INDEXABLE', steps: [] },
        ],
        sitemapUrls: ['https://example.com/', 'https://example.com/hidden'],
      }),
      {
        fetcher: mockFetcher({
          'https://example.com/': { status: 200 },
          'https://example.com/hidden': { status: 200 },
        }),
      },
    )
    expect(result.jsSuspected).toBe(true)
    expect(result.findings.some((f) => f.ruleId === 'L00_JS_SUSPECTED')).toBe(true)
    expect(result.findings.filter((f) => f.ruleId === 'L21')).toHaveLength(0)
    expect(result.findings.filter((f) => f.ruleId === 'L23')).toHaveLength(0)
  })

  it('10. report renderer never claims a rule_id absent from findings', () => {
    const findings = [
      {
        ruleId: 'L05',
        severity: 'FAIL' as const,
        sourceUrl: 'https://example.com/',
        targetUrl: 'https://example.com/old',
        evidence: {},
        suggestedTarget: 'https://example.com/new',
      },
    ]
    const causes = buildTopCauses(findings)
    const headline = buildVerdictHeadline(findings)
    expect(assertReportOnlyUsesComputedRules(findings, causes.map((c) => c.ruleId))).toBe(true)
    expect(headline.toLowerCase()).toContain('redirect')
    // No invented rule ids in causes
    expect(causes.every((c) => c.ruleId === 'L05')).toBe(true)
  })

  it('fix list only includes rules with suggested targets', async () => {
    const html = {
      'https://example.com/': `<html><body><main><a href="/old">Go</a></main></body></html>`,
    }
    const result = await runLinkGraphAudit(
      baseInput({
        htmlByUrl: html,
        pages: [{ url: 'https://example.com/', httpStatus: 200, crawlDepth: 0, verdict: 'INDEXABLE', steps: [] }],
      }),
      {
        fetcher: mockFetcher({
          'https://example.com/old': { status: 302, location: 'https://example.com/new' },
          'https://example.com/new': { status: 200 },
          'https://example.com/': { status: 200 },
        }),
      },
    )
    const rows = buildFixList(result.findings, result.edges)
    expect(rows.every((r) => r.suggested_href)).toBe(true)
    expect(rows.some((r) => r.rule_id === 'L05')).toBe(true)
  })
})

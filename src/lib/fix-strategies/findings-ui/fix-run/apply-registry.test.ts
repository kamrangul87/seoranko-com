/**
 * Per-topic apply + verifier tests for registered Fix Agent transforms,
 * plus same-file ordering when two transforms edit one path.
 */

import { describe, expect, it } from 'vitest'
import type { PersistedFindingRow } from '../crawl/constants'
import {
  applyRegisteredTransform,
  isTransformRegistered,
  orderFindingsForApply,
  resolveTransformPath,
  verifyRegisteredTransform,
} from './apply-registry'

function finding(
  partial: Partial<PersistedFindingRow> &
    Pick<PersistedFindingRow, 'id' | 'topicId' | 'verdict'>,
): PersistedFindingRow {
  const now = new Date().toISOString()
  return {
    siteId: 'site-1',
    detectOrigin: null,
    userId: 'user-1',
    kind: `topic/${partial.topicId}`,
    bucket: 'actionable',
    severity: 'moderate',
    rollupKey: `${partial.topicId}|${partial.verdict}`,
    declarationSite: null,
    affectedUrlCount: 1,
    pageUrl: null,
    detail: '',
    autoFixable: true,
    reportOnly: false,
    surfaceClass: 'auto-fixable',
    proposedDiff: null,
    evidenceValues: null,
    sourceRows: [],
    firstSeenRunId: null,
    lastSeenRunId: null,
    firstSeenAt: now,
    lastSeenAt: now,
    status: 'open',
    resolvedAt: null,
    fixedAt: null,
    verificationAt: null,
    postFixStatus: null,
    regressionObservedAt: null,
    ...partial,
  }
}

describe('apply-registry registration gate', () => {
  it('registers wired auto verdicts and excludes informational topic 28', () => {
    expect(isTransformRegistered('1', 'auto-fixable')).toBe(true)
    expect(isTransformRegistered('13', 'auto-add-self-canonical')).toBe(true)
    expect(isTransformRegistered('14', 'auto-self-canonical')).toBe(true)
    expect(isTransformRegistered('17', 'auto-collapse-redundant')).toBe(true)
    expect(isTransformRegistered('17', 'auto-remove-body-misplaced')).toBe(true)
    expect(isTransformRegistered('22', 'auto-remove-crawl-delay')).toBe(true)
    expect(isTransformRegistered('26', 'auto-remove-confirmed-4xx')).toBe(true)
    expect(isTransformRegistered('26', 'auto-replace-single-hop-redirect')).toBe(
      true,
    )
    expect(isTransformRegistered('42', 'auto-rewrite')).toBe(true)
    expect(isTransformRegistered('49', 'auto-set-dimensions')).toBe(true)

    // Topic 28 is informational by design — never registered.
    expect(isTransformRegistered('28', 'informational-unreferenced')).toBe(false)
    // Topic 22 text/plain config edit not in this wire-up.
    expect(isTransformRegistered('22', 'auto-set-text-plain')).toBe(false)
    // Human-review verdicts stay out of the registry.
    expect(isTransformRegistered('17', 'human-review-conflicting')).toBe(false)
    expect(isTransformRegistered('42', 'human-review-shared-nav')).toBe(false)
  })
})

describe('apply-registry per-topic apply + verifier', () => {
  it('topic 1: removes dead anchor and verifies absence', async () => {
    const f = finding({
      id: 'f1',
      topicId: '1',
      verdict: 'auto-fixable',
      pageUrl: 'https://example.com/about.html',
      evidenceValues: { href: '/gone' },
    })
    const before =
      '<html><body><a href="/gone">Dead</a><a href="/ok">Ok</a></body></html>'
    const applied = await applyRegisteredTransform({
      fileContent: before,
      path: 'public/about.html',
      finding: f,
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.newContent).not.toContain('href="/gone"')
    expect(applied.newContent).toContain('href="/ok"')
    const v = await verifyRegisteredTransform({
      finding: f,
      body: applied.newContent,
      liveUrl: 'https://example.com/about.html',
      stage: 'production',
    })
    expect(v.ok).toBe(true)
  })

  it('topic 13: adds head canonical and verifies one absolute tag', async () => {
    const pageUrl = 'https://example.com/about.html'
    const f = finding({
      id: 'f13',
      topicId: '13',
      verdict: 'auto-add-self-canonical',
      pageUrl,
      evidenceValues: { preferredForm: pageUrl },
    })
    const before = '<html><head><title>About</title></head><body>Hi</body></html>'
    const applied = await applyRegisteredTransform({
      fileContent: before,
      path: 'public/about.html',
      finding: f,
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.newContent).toContain(`rel="canonical" href="${pageUrl}"`)
    const fetchImpl = (async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u === pageUrl) return new Response('<html></html>', { status: 200 })
      return new Response('missing', { status: 404 })
    }) as typeof fetch
    const v = await verifyRegisteredTransform({
      finding: f,
      body: applied.newContent,
      liveUrl: pageUrl,
      stage: 'preview',
      fetchImpl,
    })
    expect(v.ok).toBe(true)
  })

  it('topic 14: repoints canonical href to self', async () => {
    const pageUrl = 'https://example.com/about.html'
    const f = finding({
      id: 'f14',
      topicId: '14',
      verdict: 'auto-self-canonical',
      pageUrl,
      evidenceValues: { selfCanonical: pageUrl },
    })
    const before = `<html><head><link rel="canonical" href="https://example.com/dead"></head><body></body></html>`
    const applied = await applyRegisteredTransform({
      fileContent: before,
      path: 'public/about.html',
      finding: f,
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.newContent).toContain(`href="${pageUrl}"`)
    const fetchImpl = (async (url: RequestInfo | URL) => {
      if (String(url) === pageUrl) return new Response('ok', { status: 200 })
      return new Response('no', { status: 404 })
    }) as typeof fetch
    const v = await verifyRegisteredTransform({
      finding: f,
      body: applied.newContent,
      liveUrl: pageUrl,
      stage: 'production',
      fetchImpl,
    })
    expect(v.ok).toBe(true)
  })

  it('topic 17: collapses redundant canonicals to one head tag', async () => {
    const pageUrl = 'https://example.com/about.html'
    const f = finding({
      id: 'f17',
      topicId: '17',
      verdict: 'auto-collapse-redundant',
      pageUrl,
      evidenceValues: { collapseTo: pageUrl },
    })
    const before = `<html><head>
      <link rel="canonical" href="${pageUrl}">
      <link rel="canonical" href="${pageUrl}">
    </head><body></body></html>`
    const applied = await applyRegisteredTransform({
      fileContent: before,
      path: 'public/about.html',
      finding: f,
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const matches = applied.newContent.match(/rel=["']canonical["']/gi) || []
    expect(matches.length).toBe(1)
    const v = await verifyRegisteredTransform({
      finding: f,
      body: applied.newContent,
      liveUrl: pageUrl,
      stage: 'preview',
    })
    expect(v.ok).toBe(true)
  })

  it('topic 22: removes crawl-delay lines from robots.txt', async () => {
    const f = finding({
      id: 'f22',
      topicId: '22',
      verdict: 'auto-remove-crawl-delay',
      pageUrl: 'https://example.com/robots.txt',
    })
    const before = 'User-agent: *\nCrawl-delay: 10\nDisallow:\n'
    const applied = await applyRegisteredTransform({
      fileContent: before,
      path: 'public/robots.txt',
      finding: f,
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.newContent).not.toMatch(/crawl-delay/i)
    const fetchImpl = (async () =>
      new Response(applied.ok ? applied.newContent : '', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })) as typeof fetch
    const v = await verifyRegisteredTransform({
      finding: f,
      body: applied.newContent,
      liveUrl: 'https://example.com/robots.txt',
      stage: 'production',
      fetchImpl,
    })
    expect(v.ok).toBe(true)
  })

  it('topic 26: removes a loc and verifies absence in sitemap XML', async () => {
    const loc = 'https://example.com/gone.html'
    const f = finding({
      id: 'f26',
      topicId: '26',
      verdict: 'auto-remove-confirmed-4xx',
      pageUrl: loc,
      evidenceValues: { loc },
    })
    const before = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${loc}</loc></url>
  <url><loc>https://example.com/</loc></url>
</urlset>`
    const applied = await applyRegisteredTransform({
      fileContent: before,
      path: 'public/sitemap.xml',
      finding: f,
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.newContent).not.toContain(loc)
    expect(applied.newContent).toContain('https://example.com/')
    const v = await verifyRegisteredTransform({
      finding: f,
      body: applied.newContent,
      liveUrl: 'https://example.com/sitemap.xml',
      stage: 'preview',
    })
    expect(v.ok).toBe(true)
  })

  it('topic 26: replaces a redirect loc', async () => {
    const loc = 'https://example.com/old.html'
    const replaceWith = 'https://example.com/new.html'
    const f = finding({
      id: 'f26r',
      topicId: '26',
      verdict: 'auto-replace-single-hop-redirect',
      pageUrl: loc,
      evidenceValues: { loc, replaceWith },
    })
    const before = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${loc}</loc></url>
</urlset>`
    const applied = await applyRegisteredTransform({
      fileContent: before,
      path: 'public/sitemap.xml',
      finding: f,
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.newContent).toContain(replaceWith)
    expect(applied.newContent).not.toContain(`<loc>${loc}</loc>`)
    const v = await verifyRegisteredTransform({
      finding: f,
      body: applied.newContent,
      liveUrl: 'https://example.com/sitemap.xml',
      stage: 'production',
    })
    expect(v.ok).toBe(true)
  })

  it('topic 42: rewrites href and verifies live HTML + destination 200', async () => {
    const pageUrl = 'https://example.com/about.html'
    const f = finding({
      id: 'f42',
      topicId: '42',
      verdict: 'auto-rewrite',
      pageUrl,
      evidenceValues: {
        href: '/old',
        rewriteHref: '/new',
      },
    })
    const before =
      '<html><body><a href="/old">Campaign</a></body></html>'
    const applied = await applyRegisteredTransform({
      fileContent: before,
      path: 'public/about.html',
      finding: f,
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.newContent).toContain('href="/new"')
    expect(applied.newContent).not.toContain('href="/old"')
    const fetchImpl = (async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('/new')) return new Response('ok', { status: 200 })
      return new Response('no', { status: 404 })
    }) as typeof fetch
    const v = await verifyRegisteredTransform({
      finding: f,
      body: applied.newContent,
      liveUrl: pageUrl,
      stage: 'preview',
      fetchImpl,
    })
    expect(v.ok).toBe(true)
  })
})

describe('same-file ordering in one run', () => {
  it('orders two transforms on the same HTML file by path → topic → id', () => {
    const a = finding({
      id: 'z-later',
      topicId: '42',
      verdict: 'auto-rewrite',
      pageUrl: 'https://example.com/about.html',
      evidenceValues: { href: '/a', rewriteHref: '/b' },
    })
    const b = finding({
      id: 'a-first',
      topicId: '1',
      verdict: 'auto-fixable',
      pageUrl: 'https://example.com/about.html',
      evidenceValues: { href: '/gone' },
    })
    const c = finding({
      id: 'other',
      topicId: '22',
      verdict: 'auto-remove-crawl-delay',
      pageUrl: 'https://example.com/robots.txt',
    })
    expect(resolveTransformPath(a)).toBe('public/about.html')
    expect(resolveTransformPath(b)).toBe('public/about.html')
    expect(resolveTransformPath(c)).toBe('public/robots.txt')

    const ordered = orderFindingsForApply([a, c, b])
    expect(ordered.map((f) => f.id)).toEqual(['a-first', 'z-later', 'other'])
    // Same path: topic 1 before topic 42
    expect(ordered[0]!.topicId).toBe('1')
    expect(ordered[1]!.topicId).toBe('42')
  })

  it('applies topic 1 then topic 42 sequentially on one file body', async () => {
    const pageUrl = 'https://example.com/about.html'
    const remove = finding({
      id: 'rm',
      topicId: '1',
      verdict: 'auto-fixable',
      pageUrl,
      evidenceValues: { href: '/gone' },
    })
    const rewrite = finding({
      id: 'rw',
      topicId: '42',
      verdict: 'auto-rewrite',
      pageUrl,
      evidenceValues: { href: '/old', rewriteHref: '/new' },
    })
    let body =
      '<html><body><a href="/gone">Dead</a><a href="/old">Old</a></body></html>'
    for (const f of orderFindingsForApply([rewrite, remove])) {
      const path = resolveTransformPath(f)!
      const applied = await applyRegisteredTransform({
        fileContent: body,
        path,
        finding: f,
      })
      expect(applied.ok).toBe(true)
      if (!applied.ok) return
      body = applied.newContent
    }
    expect(body).not.toContain('href="/gone"')
    expect(body).toContain('href="/new"')
    expect(body).not.toContain('href="/old"')
  })
})

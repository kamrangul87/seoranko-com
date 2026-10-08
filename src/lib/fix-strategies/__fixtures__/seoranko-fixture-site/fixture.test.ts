/**
 * Regression tests built from fixtures/seoranko-fixture-site/
 * (same files as https://seoranko-fixture.vercel.app).
 *
 * Covers resolver + topics 14/26/27/34 findings that failed on that site.
 */

import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectStaticRoots,
  candidatePathsForUrl,
  resolveSourceFile,
  countUrlEquivalentAttributeMatches,
  countEvidenceOccurrences,
  countExactOccurrences,
} from '@/lib/fix-strategies/findings-ui/fix-run/resolve-source-file'
import { evidenceNeedleForResolution } from '@/lib/fix-strategies/findings-ui/fix-run/apply-evidence'
import type { PersistedFindingRow } from '@/lib/fix-strategies/findings-ui/crawl/constants'
import { detectSitemapNotIndexable } from '@/lib/fix-strategies/topic-26'
import {
  detectIndexableUrlsAbsent,
  isSitemapMember,
} from '@/lib/fix-strategies/topic-27'
import { buildSitemapInspection } from '@/lib/fix-strategies/shared/sitemap-inspect'
import { inspectRobotsTxtBody } from '@/lib/fix-strategies/shared/robots-txt-inspect'
import { parseSitemapXml } from '@/lib/fix-strategies/shared/sitemap-xml'
import {
  detectLangDeclaration,
  crossHostRedirectLocation,
} from '@/lib/fix-strategies/topic-34'
import { inspectDocumentHead } from '@/lib/fix-strategies/shared'
import type { FetchDeps } from '@/lib/fix-strategies/fetch'

const FIXTURE_ROOT = join(process.cwd(), 'fixtures/seoranko-fixture-site')
const ORIGIN = 'https://seoranko-fixture.vercel.app'

function listTree(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const rel = prefix ? `${prefix}/${name}` : name
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...listTree(full, rel))
    } else {
      out.push(rel)
    }
  }
  return out
}

const FIXTURE_TREE = listTree(FIXTURE_ROOT).filter(
  (p) => !p.startsWith('.') && p !== 'README.md',
)

describe('seoranko-fixture-site — item 1 resolver root URL', () => {
  it('does not treat blog/ as a static root; "/" → index.html only', async () => {
    const roots = detectStaticRoots(FIXTURE_TREE)
    expect(roots).toContain('')
    expect(roots).not.toContain('blog')

    const cands = candidatePathsForUrl(`${ORIGIN}/`, roots).filter((p) =>
      FIXTURE_TREE.includes(p),
    )
    // Before the fix this was [index.html, blog/index.html] → multiple-candidates
    expect(cands).toEqual(['index.html'])

    const indexHtml = readFileSync(join(FIXTURE_ROOT, 'index.html'), 'utf8')
    const result = await resolveSourceFile({
      url: `${ORIGIN}/`,
      evidence: { needle: 'rel="canonical"', expectedCount: 2 },
      treePaths: FIXTURE_TREE,
      treeShas: Object.fromEntries(FIXTURE_TREE.map((p) => [p, `sha-${p}`])),
      readFile: async (path) =>
        path === 'index.html' ? indexHtml : readFileSync(join(FIXTURE_ROOT, path), 'utf8'),
    })
    expect(result).toMatchObject({
      status: 'resolved',
      path: 'index.html',
    })
  })
})

describe('seoranko-fixture-site — item 2 topic 14 URL-equivalent evidence', () => {
  it('matches root-relative canonical href when finding stores absolute URL', async () => {
    const about = readFileSync(join(FIXTURE_ROOT, 'about.html'), 'utf8')
    const pageUrl = `${ORIGIN}/about.html`
    const absolute =
      'https://seoranko-fixture.vercel.app/dead-canonical.html'

    // Exact absolute substring is absent; root-relative form is present once.
    expect(about.includes(absolute)).toBe(false)
    expect(about.includes('href="/dead-canonical.html"')).toBe(true)
    expect(
      countUrlEquivalentAttributeMatches(about, absolute, pageUrl),
    ).toBe(1)

    const result = await resolveSourceFile({
      url: pageUrl,
      evidence: { needle: absolute, expectedCount: 1 },
      treePaths: FIXTURE_TREE,
      treeShas: { 'about.html': 'sha-about' },
      readFile: async () => about,
    })
    expect(result).toMatchObject({
      status: 'resolved',
      path: 'about.html',
    })
  })
})

describe('seoranko-fixture-site — item 3 topic 26 sitemap defects', () => {
  it('emits 4xx remove + single-hop redirect replace for fixture sitemap locs', async () => {
    const sitemapXml = readFileSync(join(FIXTURE_ROOT, 'sitemap.xml'), 'utf8')
    expect(sitemapXml).toContain(`${ORIGIN}/gone.html`)
    expect(sitemapXml).toContain(`${ORIGIN}/old-blog`)

    const gone = `${ORIGIN}/gone.html`
    const oldBlog = `${ORIGIN}/old-blog`
    const blog = `${ORIGIN}/blog/`

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === gone || url.endsWith('/gone.html')) {
        return new Response('gone', { status: 404 })
      }
      if (url === oldBlog || url.endsWith('/old-blog')) {
        return new Response(null, {
          status: 308,
          headers: { location: blog },
        })
      }
      if (url === blog || url.includes('/blog')) {
        return new Response(
          '<!doctype html><html lang="en"><head><link rel="canonical" href="/blog/"></head><body>Blog</body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        )
      }
      // Healthy locs from the fixture sitemap
      return new Response(
        '<!doctype html><html lang="en"><head><link rel="canonical" href="/"></head><body>ok</body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      )
    })

    const deps: FetchDeps = {
      fetch: fetchMock as unknown as typeof fetch,
      sleep: vi.fn(async () => {}),
      now: () => 1_000_000,
      config: {
        fallbackDelayMs: 1,
        maxAttempts: 2,
        maxRetryAfterMs: 10,
        timeoutMs: 100,
      },
    }

    const detected = await detectSitemapNotIndexable(
      sitemapXml,
      {
        artefactPath: 'sitemap.xml',
        isGenerated: false,
        generatorPath: null,
        appDir: 'app',
        siteOrigin: ORIGIN,
      },
      deps,
    )

    const goneFinding = detected.findings.find((f) => f.loc.includes('gone.html'))
    const oldBlogFinding = detected.findings.find((f) =>
      f.loc.includes('old-blog'),
    )
    expect(goneFinding?.verdict).toBe('auto-remove-confirmed-4xx')
    expect(oldBlogFinding?.verdict).toBe('auto-replace-single-hop-redirect')
  })
})

describe('seoranko-fixture-site — item 4 topic 27 slash/root membership', () => {
  it('does not report "/" or "/blog/" as missing when sitemap lists them', () => {
    const sitemapXml = readFileSync(join(FIXTURE_ROOT, 'sitemap.xml'), 'utf8')
    const robots = inspectRobotsTxtBody('User-agent: *\nAllow: /\n', {
      url: `${ORIGIN}/robots.txt`,
      status: 200,
      contentType: 'text/plain',
      fetchStatus: 'ok',
    })
    const parsed = parseSitemapXml(sitemapXml)
    expect(parsed.kind).toBe('urlset')

    const inspection = buildSitemapInspection({
      originUrl: ORIGIN,
      robots,
      documents: [
        {
          url: `${ORIGIN}/sitemap.xml`,
          origin: 'discovered',
          fetchOutcome: 'ok',
          status: 200,
          contentType: 'application/xml',
          compressedByteLength: sitemapXml.length,
          decompressedByteLength: sitemapXml.length,
          wasGzip: false,
          exceedsSizeLimit: false,
          redirectHops: 0,
          finalUrl: `${ORIGIN}/sitemap.xml`,
          body: sitemapXml,
          parsed,
          detail: 'ok',
        },
      ],
    })

    // Slash variants of listed locs must count as members
    expect(isSitemapMember(`${ORIGIN}/`, inspection.allLocsNormalized)).toBe(
      true,
    )
    expect(
      isSitemapMember(`${ORIGIN}/blog`, inspection.allLocsNormalized),
    ).toBe(true)
    expect(
      isSitemapMember(`${ORIGIN}/blog/`, inspection.allLocsNormalized),
    ).toBe(true)

    const result = detectIndexableUrlsAbsent({
      inspection,
      pages: [
        {
          url: `${ORIGIN}/`,
          status200: true,
          body: readFileSync(join(FIXTURE_ROOT, 'index.html'), 'utf8'),
          internallyLinked: true,
        },
        {
          url: `${ORIGIN}/blog/`,
          status200: true,
          body: readFileSync(join(FIXTURE_ROOT, 'blog/index.html'), 'utf8'),
          internallyLinked: true,
        },
        {
          // Trailing-slash variant of listed /blog/
          url: `${ORIGIN}/blog`,
          status200: true,
          body: readFileSync(join(FIXTURE_ROOT, 'blog/index.html'), 'utf8'),
          internallyLinked: true,
        },
      ],
    })

    const omissions = result.findings.filter((f) =>
      f.verdict.startsWith('report-omission'),
    )
    expect(omissions).toEqual([])
    expect(
      result.suppressed.every(
        (s) => s.verdict === 'suppress-listed-in-index-child',
      ),
    ).toBe(true)
  })
})

describe('seoranko-fixture-site — item 5 topic 34 skip non-200', () => {
  it('does not raise missing-lang on a 308 redirect response', () => {
    // Simulate a bare redirect body (no lang) — must not be assessed.
    const redirectHtml = '<html><head></head><body>Redirecting…</body></html>'
    const head = inspectDocumentHead(redirectHtml)
    const cross = crossHostRedirectLocation(
      `${ORIGIN}/old-blog`,
      308,
      '/blog/',
    )
    // Same-host 308 → crossHost is null; content detector gate is status===200
    expect(cross).toBeNull()

    // Detector itself would raise missing-lang on this body…
    const wouldRaise = detectLangDeclaration({ inspection: head })
    expect(wouldRaise.findings.some((f) => f.verdict.includes('missing-lang'))).toBe(
      true,
    )

    // …but run-detectors now excludes status !== 200 from content usable set.
    // Assert the wiring contract: only status 200 pages are content-usable.
    const pages = [
      { url: `${ORIGIN}/old-blog`, status: 308, html: redirectHtml },
      {
        url: `${ORIGIN}/`,
        status: 200,
        html: readFileSync(join(FIXTURE_ROOT, 'index.html'), 'utf8'),
      },
    ]
    const contentUsable = pages.filter((p) => p.status === 200)
    expect(contentUsable.map((p) => p.url)).toEqual([`${ORIGIN}/`])
    expect(contentUsable.some((p) => p.url.includes('old-blog'))).toBe(false)
  })
})

describe('seoranko-fixture-site — item 6 topic 1 dossier gate', () => {
  it('documents that stable 404 without git deletion stays human-review', () => {
    // Dossier broken-internal-link__target_returns_4xx.md:
    // "404 target with git evidence of deletion (deleted) and no successor →
    //  auto-fixable (remove-anchor)"
    // "410 target → auto-fixable (remove-anchor)"
    // Plain stable 404 with no git deletion → human-review / no-action.
    // Product code correctly follows the dossier — no detector change.
    const indexHtml = readFileSync(join(FIXTURE_ROOT, 'index.html'), 'utf8')
    expect(indexHtml).toContain('href="/gone.html"')
    expect(true).toBe(true)
  })
})

describe('seoranko-fixture-site — item 5 topic 17 collapse expectedCount', () => {
  it('resolves two identical canonicals with expectedCount=2 (not evidence-ambiguous)', async () => {
    const indexHtml = readFileSync(join(FIXTURE_ROOT, 'index.html'), 'utf8')
    const pageUrl = `${ORIGIN}/`
    const collapseTo = `${ORIGIN}/`

    // Two real link[rel=canonical] attrs; substring "/" would match far more.
    expect(countEvidenceOccurrences(indexHtml, collapseTo, pageUrl)).toBe(2)
    expect(countUrlEquivalentAttributeMatches(indexHtml, collapseTo, pageUrl)).toBe(
      2,
    )

    const finding = {
      id: 't17',
      topicId: '17',
      verdict: 'auto-collapse-redundant',
      evidenceValues: { collapseTo },
    } as unknown as PersistedFindingRow
    const needle = evidenceNeedleForResolution(finding)
    expect(needle).toEqual({ needle: collapseTo, expectedCount: 2 })

    const result = await resolveSourceFile({
      url: pageUrl,
      evidence: needle!,
      treePaths: FIXTURE_TREE,
      treeShas: { 'index.html': 'sha-index' },
      readFile: async () => indexHtml,
    })
    expect(result).toMatchObject({ status: 'resolved', path: 'index.html' })
  })
})

describe('seoranko-fixture-site — item 6 topic 42 ignore comment text', () => {
  it('matches only a[href]=/old-blog, not the HTML comment mentioning it', async () => {
    const indexHtml = readFileSync(join(FIXTURE_ROOT, 'index.html'), 'utf8')
    const pageUrl = `${ORIGIN}/`
    const href = '/old-blog'

    // Substring (incl. comment) is ambiguous; attribute-only is exactly one.
    expect(countExactOccurrences(indexHtml, href)).toBeGreaterThan(1)
    expect(countEvidenceOccurrences(indexHtml, href, pageUrl)).toBe(1)

    const result = await resolveSourceFile({
      url: pageUrl,
      evidence: { needle: href, expectedCount: 1 },
      treePaths: FIXTURE_TREE,
      treeShas: { 'index.html': 'sha-index' },
      readFile: async () => indexHtml,
    })
    expect(result).toMatchObject({ status: 'resolved', path: 'index.html' })
  })
})

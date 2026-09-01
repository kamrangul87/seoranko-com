import { describe, expect, it } from 'vitest'
import { matchRobotsForUrl } from './robots-parser'
import { jaccardSimilarity, fingerprintShingles, extractMainContentText } from './content-fingerprint'
import { evaluatePageIndexability, pathPatternForUrl } from './indexability'
import { buildCohortComparison } from './cohorts'
import { buildIndexDiagnosisVerdict } from './verdict'
import type { FetchedPage } from './crawler'
import type { CrawlCoverage, PageIndexability } from './types'

const ROBOTS = `User-agent: *
Disallow: /private/
Allow: /public/

User-agent: GPTBot
Disallow: /`

function mockPage(overrides: Partial<FetchedPage> & { url: string }): FetchedPage {
  return {
    finalUrl: overrides.url,
    httpStatus: 200,
    html: '<html><head><title>T</title></head><body><p>Hello world content here for shingles</p></body></html>',
    depth: 0,
    redirectCount: 0,
    xRobotsTag: '',
    metaRobots: '',
    canonicalUrl: overrides.url,
    canonicalTags: [overrides.url],
    fetchError: null,
    timedOut: false,
    ...overrides,
  }
}

describe('robots-parser', () => {
  it('matches disallow rule with literal line evidence', () => {
    const m = matchRobotsForUrl(ROBOTS, 'https://example.com/private/secret')
    expect(m.allowed).toBe(false)
    expect(m.evidence).toContain('Disallow')
    expect(m.evidence).toContain('/private/')
  })

  it('allows paths with no matching rule', () => {
    const m = matchRobotsForUrl(ROBOTS, 'https://example.com/about')
    expect(m.allowed).toBe(true)
  })
})

describe('content-fingerprint', () => {
  it('clusters near-identical pages', () => {
    const a = 'buy widgets online cheap widgets free shipping widgets today'
    const b = 'buy widgets online cheap widgets free shipping widgets now'
    const sim = jaccardSimilarity(fingerprintShingles(a), fingerprintShingles(b))
    expect(sim).toBeGreaterThan(0.5)
  })

  it('extracts main content excluding nav', () => {
    const html =
      '<nav>menu</nav><main><p>Unique product description text here with enough words to fingerprint reliably for duplicate detection tests.</p></main>'
    const text = extractMainContentText(html)
    expect(text).toContain('unique product')
    expect(text).not.toContain('menu')
  })
})

describe('indexability chain', () => {
  it('marks noindex meta as BLOCKED with evidence', () => {
    const page = mockPage({
      url: 'https://example.com/page',
      metaRobots: 'noindex, follow',
      html: '<html><head><meta name="robots" content="noindex, follow"></head><body></body></html>',
    })
    const result = evaluatePageIndexability(page, ROBOTS, [], null, 1, 'text')
    expect(result.verdict).toBe('BLOCKED')
    expect(result.decisiveEvidence).toContain('noindex')
  })

  it('marks cross-domain canonical as AT_RISK', () => {
    const page = mockPage({
      url: 'https://example.com/page',
      canonicalTags: ['https://other.com/page'],
      html: '<html><head><link rel="canonical" href="https://other.com/page"></head><body></body></html>',
    })
    const result = evaluatePageIndexability(page, ROBOTS, [], null, 1, 'text')
    expect(result.verdict).toBe('AT_RISK')
    expect(result.decisiveEvidence).toContain('off-site')
  })

  it('derives path patterns', () => {
    expect(pathPatternForUrl('https://x.com/blog/my-long-slug-here')).toMatch(/blog/)
  })
})

describe('verdict', () => {
  it('produces headline with discovered/crawled counts', () => {
    const coverage: CrawlCoverage = {
      domain: 'example.com',
      seedUrl: 'https://example.com/',
      discoveredCount: 100,
      fetchedCount: 50,
      excluded: [],
      excludedByReason: {
        ROBOTS_DISALLOWED: 0,
        META_NOINDEX: 0,
        X_ROBOTS_NOINDEX: 0,
        NON_200: 0,
        DEPTH_LIMIT: 0,
        TIMEOUT: 0,
        PLAN_LIMIT: 0,
        REDIRECT_CHAIN: 0,
        NOT_REACHED: 0,
      },
      terminationReason: 'FETCH_BUDGET_EXHAUSTED',
      terminationEvidence: 'limit',
      discoverySources: { sitemap: 80, links: 20, both: 0, seed: 1 },
      sitemapOnlyUrls: [],
      linkedOnlyUrls: [],
      robotsTxtFetched: true,
      robotsTxtEvidence: 'ok',
    }
    const pages: PageIndexability[] = [
      {
        url: 'https://example.com/a',
        verdict: 'BLOCKED',
        decisiveStep: 'meta_robots',
        decisiveEvidence: '<meta name="robots" content="noindex">',
        steps: [],
        httpStatus: 200,
        crawlDepth: 0,
        internalLinksIn: 0,
        inboundLinks: [],
        duplicateClusterId: null,
        duplicateClusterSize: 1,
        mainContentFingerprint: 'fp-1',
        pathPattern: '/',
        depthBand: '0-home',
      },
    ]
    const v = buildIndexDiagnosisVerdict(coverage, pages)
    expect(v.headline).toContain('100')
    expect(v.headline).toContain('50')
    expect(v.topCauses.length).toBeGreaterThan(0)
    expect(v.topCauses[0]!.exampleEvidence).toContain('noindex')
  })
})

describe('cohorts', () => {
  it('flags cohorts with high duplicate density', () => {
    const pages: PageIndexability[] = Array.from({ length: 6 }, (_, i) => ({
      url: `https://example.com/p/${i}`,
      verdict: 'AT_RISK' as const,
      decisiveStep: 'duplicate_cluster' as const,
      decisiveEvidence: 'dup',
      steps: [],
      httpStatus: 200,
      crawlDepth: 2,
      internalLinksIn: 0,
      inboundLinks: [],
      duplicateClusterId: 'dup-1',
      duplicateClusterSize: 6,
      mainContentFingerprint: `fp-${i}`,
      pathPattern: '/p/:slug',
      depthBand: '2',
    }))
    const cohorts = buildCohortComparison(pages)
    const flagged = cohorts.filter((c) => c.flagged)
    expect(flagged.length).toBeGreaterThan(0)
  })
})

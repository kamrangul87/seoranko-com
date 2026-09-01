import { describe, expect, it } from 'vitest'
import { buildSiteFollowUpTasks } from './follow-up-tasks'
import {
  buildInboundLinkMap,
  generateManualFixForTask,
  lookupManualFixForUrl,
} from './manual-fixes'
import type { FetchedPage } from './crawler'
import type { IndexDiagnosisResult, PageIndexability } from './types'

function mockPage(overrides: Partial<FetchedPage> & { url: string; html?: string }): FetchedPage {
  const url = overrides.url
  return {
    finalUrl: url,
    httpStatus: 200,
    html:
      overrides.html ||
      `<html><head><link rel="canonical" href="https://other.example/blog/"></head><body><a href="/privacy">Privacy</a></body></html>`,
    depth: 0,
    redirectCount: 0,
    xRobotsTag: '',
    metaRobots: '',
    canonicalUrl: url,
    canonicalTags: [url],
    pageTitle: '',
    pageH1: '',
    fetchError: null,
    timedOut: false,
    ...overrides,
  }
}

describe('manual-fixes', () => {
  it('generates canonical tag + three redirect formats for index.html mismatch', () => {
    const pageUrl = 'https://autodun.com/blog/index.html'
    const pages: PageIndexability[] = [
      {
        url: pageUrl,
        verdict: 'AT_RISK',
        decisiveStep: 'canonical',
        decisiveEvidence: 'Canonical points elsewhere',
        steps: [
          {
            step: 'canonical',
            passed: false,
            evidence: `Canonical points to different same-host URL: https://autodun.com/blog/ (page ${pageUrl})`,
          },
        ],
        httpStatus: 200,
        crawlDepth: 2,
        internalLinksIn: 1,
        inboundLinks: [],
        duplicateClusterId: null,
        duplicateClusterSize: 1,
        mainContentFingerprint: 'fp',
        pathPattern: '/blog/index.html',
        depthBand: '2',
        pageTitle: 'Blog index',
        pageH1: 'Blog',
      },
    ]
    const task = buildSiteFollowUpTasks({
      coverage: {
        domain: 'autodun.com',
        seedUrl: 'https://autodun.com/',
        discoveredCount: 10,
        fetchedCount: 5,
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
        terminationReason: 'QUEUE_EMPTY',
        terminationEvidence: 'done',
        discoverySources: { sitemap: 0, links: 5, both: 0, seed: 1 },
        sitemapOnlyUrls: [],
        linkedOnlyUrls: [],
        robotsTxtFetched: true,
        robotsTxtEvidence: 'ok',
      },
      pages,
      cohorts: [],
      verdict: {
        headline: 'test',
        topCauses: [],
        indexableCount: 1,
        blockedCount: 0,
        atRiskCount: 1,
      },
      followUpTasks: [],
      ranAt: '',
    })[0]!

    const fix = generateManualFixForTask(task, { pages } as IndexDiagnosisResult, new Map())
    expect(fix?.fixType).toBe('canonical')
    expect(fix?.snippets.some((s) => s.kind === 'html' && s.content.includes('rel="canonical"'))).toBe(true)
    expect(fix?.snippets.filter((s) => s.kind.startsWith('redirect-'))).toHaveLength(3)
    const next = fix?.snippets.find((s) => s.kind === 'redirect-nextjs')
    expect(next?.content).toMatch(/async redirects\(\)/)
    expect(next?.placementBefore).toMatch(/next\.config/)
    expect(fix?.evidenceCitation).toContain('autodun.com/blog/index.html')
  })

  it('routes sitemap gap to Sitemap Generator instead of XML fragments', () => {
    const urls = ['https://autodun.com/mot-predictor', 'https://autodun.com/charging-map']
    const task = {
      id: 'sitemap-missing-linked-urls',
      kind: 'sitemap_gap' as const,
      title: 'Linked URLs missing from sitemap',
      detail: '',
      evidence: 'count=2',
      affectedUrls: urls,
    }
    const result = {
      coverage: {
        domain: 'autodun.com',
        linkedOnlyUrls: urls,
        robotsTxtEvidence: 'robots ok',
      },
    } as IndexDiagnosisResult
    const fix = generateManualFixForTask(task, result, new Map())
    expect(fix?.fixType).toBe('sitemap_gap')
    expect(fix?.fixMode).toBe('infrastructure')
    expect(fix?.sitemapDomain).toBe('autodun.com')
    expect(fix?.linkedOnlyHighlight).toEqual(urls)
    expect(fix?.contentFixKind).toBeUndefined()
    expect(fix?.snippets).toHaveLength(0)
  })

  it('lists inbound link sources for non-200 URLs', () => {
    const dead = 'https://autodun.com/privacy'
    const home = 'https://autodun.com/'
    const inboundMap = buildInboundLinkMap([
      mockPage({
        url: home,
        html: '<html><body><footer><a href="/privacy">Privacy</a></footer></body></html>',
      }),
    ])
    expect(inboundMap.get(dead)?.[0]?.fromUrl).toBe(home)

    const task = {
      id: 'non-200-linked-urls',
      kind: 'non_200' as const,
      title: 'Non-200',
      detail: '',
      evidence: 'HTTP 404',
      affectedUrls: [dead],
    }
    const result = {
      coverage: {
        excluded: [{ url: dead, reason: 'NON_200', evidence: 'HTTP 404 at privacy', httpStatus: 404 }],
      },
    } as IndexDiagnosisResult
    const fix = generateManualFixForTask(task, result, inboundMap)
    expect(fix?.snippets.some((s) => s.content.includes(home))).toBe(true)
    expect(fix?.snippets.filter((s) => s.kind.startsWith('redirect-')).length).toBeGreaterThan(0)
    expect(fix?.removeLinkGuidance).toMatch(/remove/)
  })

  it('lookupManualFixForUrl resolves sitemap gap and non-200 by URL', () => {
    const dead = 'https://autodun.com/terms'
    const gap = 'https://autodun.com/mot-predictor'
    const result = {
      coverage: {
        domain: 'autodun.com',
        linkedOnlyUrls: [gap],
        excluded: [{ url: dead, reason: 'NON_200', evidence: 'HTTP 404', httpStatus: 404 }],
      },
      pages: [],
      cohorts: [],
    } as IndexDiagnosisResult
    expect(lookupManualFixForUrl(gap, result, new Map())?.fixType).toBe('sitemap_gap')
    expect(lookupManualFixForUrl(dead, result, new Map())?.fixType).toBe('non_200')
  })

  it('duplicate cohort fix routes to brief context, not fabricated snippets', () => {
    const task = {
      id: 'cohort-dup-path:/blog/:slug.html',
      kind: 'duplicate_cohort' as const,
      title: 'Near-duplicate cohort: /blog/:slug.html',
      detail: '',
      evidence: '33% density',
      affectedUrls: [],
    }
    const result = {
      pages: [
        {
          url: 'https://autodun.com/blog/mot-history-check-uk.html',
          pathPattern: '/blog/:slug.html',
          pageTitle: 'MOT History Check UK',
          pageH1: 'MOT History Check UK',
        },
        {
          url: 'https://autodun.com/blog/electric-car-charger-map-uk.html',
          pathPattern: '/blog/:slug.html',
          pageTitle: 'Electric Car Charger Map UK',
          pageH1: 'Electric Car Charger Map UK',
        },
      ],
      cohorts: [
        {
          cohortId: 'path:/blog/:slug.html',
          label: 'Path /blog/:slug.html',
          kind: 'path_pattern',
          duplicateClusterDensity: 0.33,
          flagEvidence: '33% vs median',
        },
      ],
    } as IndexDiagnosisResult
    const fix = generateManualFixForTask(task, result, new Map())
    expect(fix?.fixType).toBe('duplicate_cohort')
    expect(fix?.snippets).toHaveLength(0)
    expect(fix?.briefSeedKeyword).toMatch(/UK|EV|MOT/i)
    expect(fix?.briefContext?.sharedTopic).not.toMatch(/Path \//)
    expect(fix?.briefContext?.pageSummaries.length).toBeGreaterThan(0)
  })
})

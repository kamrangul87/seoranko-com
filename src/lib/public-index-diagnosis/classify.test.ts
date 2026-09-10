import { describe, expect, it } from 'vitest'
import { classifyPublicScan } from './classify'
import type { FetchedPage } from '@/lib/index-diagnosis/crawler'
import type { CrawlCoverage } from '@/lib/index-diagnosis/types'

function emptyCoverage(over: Partial<CrawlCoverage> = {}): CrawlCoverage {
  return {
    domain: 'example.com',
    seedUrl: 'https://example.com/',
    discoveredCount: 1,
    fetchedCount: 1,
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
    terminationEvidence: 'ok',
    discoverySources: { sitemap: 0, links: 0, both: 0, seed: 1 },
    sitemapOnlyUrls: [],
    linkedOnlyUrls: [],
    sitemapDiscoveredUrls: [],
    robotsTxtFetched: true,
    robotsTxtEvidence: 'ok',
    ...over,
  }
}

function page(over: Partial<FetchedPage> & { finalUrl: string }): FetchedPage {
  const finalUrl = over.finalUrl
  const base: FetchedPage = {
    url: finalUrl,
    finalUrl,
    httpStatus: 200,
    html: `<html><head><title>Real Article About Widgets</title></head><body><h1>Real Article About Widgets</h1><p>${'word '.repeat(250)}</p></body></html>`,
    depth: 0,
    redirectCount: 0,
    xRobotsTag: '',
    metaRobots: '',
    canonicalUrl: finalUrl,
    canonicalTags: [finalUrl],
    pageTitle: 'Real Article About Widgets',
    pageH1: 'Real Article About Widgets',
    fetchError: null,
    timedOut: false,
  }
  return { ...base, ...over, finalUrl, url: over.url ?? finalUrl }
}

describe('classifyPublicScan', () => {
  it('marks noindex meta as NOINDEX_TAG', () => {
    const result = classifyPublicScan({
      coverage: emptyCoverage(),
      robotsTxt: '',
      fetchedPages: [
        page({
          finalUrl: 'https://example.com/hidden',
          metaRobots: 'noindex, follow',
          html: '<html><head><meta name="robots" content="noindex, follow"><title>Hidden</title></head><body><p>hi</p></body></html>',
        }),
      ],
    })
    expect(result.urls[0]?.reason).toBe('NOINDEX_TAG')
    expect(result.topCauses[0]?.reason).toBe('NOINDEX_TAG')
    expect(result.topCauses[0]?.autoFixable).toBe(false)
    expect(result.topCauses[0]?.action.toLowerCase()).toMatch(/remove noindex|meta/)
  })

  it('marks thin content when main text < 200 words', () => {
    const result = classifyPublicScan({
      coverage: emptyCoverage(),
      robotsTxt: '',
      fetchedPages: [
        page({
          finalUrl: 'https://example.com/thin',
          html: '<html><head><title>Thin</title></head><body><h1>Thin</h1><p>Only a few words here.</p></body></html>',
          pageTitle: 'Thin',
          pageH1: 'Thin',
        }),
      ],
    })
    expect(result.urls[0]?.reason).toBe('THIN_CONTENT')
    expect(result.topCauses[0]?.autoFixable).toBe(false)
    expect(result.topCauses[0]?.action.length).toBeGreaterThan(10)
  })

  it('flags HTTP_4XX as auto-fixable with a concrete action', () => {
    const result = classifyPublicScan({
      coverage: emptyCoverage({
        fetchedCount: 0,
        excluded: [
          {
            url: 'https://example.com/gone',
            reason: 'NON_200',
            evidence: 'HTTP 404',
            httpStatus: 404,
          },
        ],
        excludedByReason: {
          ...emptyCoverage().excludedByReason,
          NON_200: 1,
        },
      }),
      robotsTxt: '',
      fetchedPages: [],
    })
    expect(result.urls[0]?.reason).toBe('HTTP_4XX')
    expect(result.topCauses[0]?.reason).toBe('HTTP_4XX')
    expect(result.topCauses[0]?.autoFixable).toBe(true)
    expect(result.topCauses[0]?.action.toLowerCase()).toMatch(/restore|remove/)
  })

  it('maps robots-excluded URLs to BLOCKED_BY_ROBOTS', () => {
    const result = classifyPublicScan({
      coverage: emptyCoverage({
        fetchedCount: 0,
        excluded: [
          {
            url: 'https://example.com/admin',
            reason: 'ROBOTS_DISALLOWED',
            evidence: 'Disallow rule matched: "Disallow: /admin"',
          },
        ],
        excludedByReason: {
          ...emptyCoverage().excludedByReason,
          ROBOTS_DISALLOWED: 1,
        },
      }),
      robotsTxt: 'User-agent: *\nDisallow: /admin\n',
      fetchedPages: [],
    })
    expect(result.urls[0]?.reason).toBe('BLOCKED_BY_ROBOTS')
    expect(result.urls[0]?.robotsRuleLine).toMatch(/Disallow:\s*\/admin/i)
    expect(result.topCauses[0]?.action.toLowerCase()).toMatch(/robots\.txt|disallow/)
  })
})

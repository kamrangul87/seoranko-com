import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverSitemapUrls } from '@/lib/index-diagnosis/sitemap-discovery'
import { detectSitemapDrift } from './drift'
import type { SitemapCrawlInput } from './types'
import type { PageIndexability } from '@/lib/index-diagnosis/types'

vi.mock('@/lib/index-diagnosis/sitemap-discovery', () => ({
  discoverSitemapUrls: vi.fn(),
}))

function mockInput(): SitemapCrawlInput {
  const pages: PageIndexability[] = [
    {
      url: 'https://autodun.com/',
      verdict: 'INDEXABLE',
      decisiveStep: null,
      decisiveEvidence: 'ok',
      steps: [
        { step: 'http_status', passed: true, evidence: 'HTTP 200' },
        { step: 'meta_robots', passed: true, evidence: 'No meta robots tag' },
        { step: 'x_robots', passed: true, evidence: 'No X-Robots-Tag header' },
      ],
      httpStatus: 200,
      crawlDepth: 0,
      internalLinksIn: 1,
      inboundLinks: [],
      duplicateClusterId: null,
      duplicateClusterSize: 1,
      mainContentFingerprint: 'fp',
      pathPattern: '/',
      depthBand: '0-home',
      pageTitle: 'Home',
      pageH1: 'Home',
    },
  ]

  return {
    domain: 'autodun.com',
    seedUrl: 'https://autodun.com/',
    pages,
    coverage: {
      domain: 'autodun.com',
      seedUrl: 'https://autodun.com/',
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
      terminationEvidence: 'done',
      discoverySources: { sitemap: 0, links: 1, both: 0, seed: 1 },
      sitemapOnlyUrls: [],
      linkedOnlyUrls: [],
      sitemapDiscoveredUrls: [],
      robotsTxtFetched: true,
      robotsTxtEvidence: 'ok',
    },
    robotsTxt: 'User-agent: *\nDisallow:',
    ranAt: '2026-09-01T00:00:00.000Z',
    crawlSource: 'fresh',
  }
}

function indexableBlogPair(): PageIndexability[] {
  const blog = {
    url: 'https://autodun.com/blog',
    verdict: 'INDEXABLE' as const,
    decisiveStep: null,
    decisiveEvidence: 'ok',
    steps: [
      { step: 'canonical' as const, passed: true, evidence: 'Canonical matches this page (equivalent URL): https://autodun.com/blog/index.html' },
      { step: 'http_status' as const, passed: true, evidence: 'HTTP 200' },
      { step: 'meta_robots' as const, passed: true, evidence: 'No meta robots tag' },
      { step: 'x_robots' as const, passed: true, evidence: 'No X-Robots-Tag header' },
    ],
    httpStatus: 200,
    crawlDepth: 1,
    internalLinksIn: 1,
    inboundLinks: [],
    duplicateClusterId: null,
    duplicateClusterSize: 1,
    mainContentFingerprint: 'fp',
    pathPattern: '/blog',
    depthBand: '1',
    pageTitle: 'Blog',
    pageH1: 'Blog',
  }
  const indexHtml = {
    ...blog,
    url: 'https://autodun.com/blog/index.html',
    steps: [
      { step: 'canonical' as const, passed: true, evidence: 'Canonical self-reference: https://autodun.com/blog/index.html' },
      { step: 'http_status' as const, passed: true, evidence: 'HTTP 200' },
      { step: 'meta_robots' as const, passed: true, evidence: 'No meta robots tag' },
      { step: 'x_robots' as const, passed: true, evidence: 'No X-Robots-Tag header' },
    ],
  }
  return [blog, indexHtml]
}

describe('detectSitemapDrift live health', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('flags live sitemap URLs that do not return 200', async () => {
    vi.mocked(discoverSitemapUrls).mockResolvedValue({
      urls: ['https://autodun.com/', 'https://autodun.com/gone'],
      evidence: 'sitemap.xml → 2 URLs',
    })

    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://autodun.com/') return new Response('', { status: 200 })
      return new Response('', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const drift = await detectSitemapDrift(mockInput())
    expect(drift.liveHealthChecked).toBe(true)
    expect(drift.liveHealthFailures).toHaveLength(1)
    expect(drift.liveHealthFailures[0]!.url).toBe('https://autodun.com/gone')
    expect(drift.hasDrift).toBe(true)
  })

  it('does not flag blog/index.html missing when live matches generated sitemap (canonical duplicate)', async () => {
    const pages = indexableBlogPair()
    const input: SitemapCrawlInput = {
      ...mockInput(),
      pages,
      coverage: { ...mockInput().coverage, fetchedCount: 2, discoveredCount: 2 },
    }

    vi.mocked(discoverSitemapUrls).mockResolvedValue({
      urls: ['https://autodun.com/blog'],
      evidence: 'sitemap.xml → 1 URLs',
    })

    const fetchMock = vi.fn(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const drift = await detectSitemapDrift(input)
    expect(drift.expectedSitemapUrls).toEqual(['https://autodun.com/blog'])
    expect(drift.sitemapExcludedUrls.some((e) => e.url.includes('blog/index.html'))).toBe(true)
    expect(drift.missingFromLive).toEqual([])
    expect(drift.hasDrift).toBe(false)
  })

  it('reports genuinely missing sitemap URLs explicitly', async () => {
    const input = mockInput()
    vi.mocked(discoverSitemapUrls).mockResolvedValue({
      urls: [],
      evidence: 'no sitemap',
    })

    const drift = await detectSitemapDrift(input)
    expect(drift.missingFromLive).toEqual(['https://autodun.com/'])
    expect(drift.hasDrift).toBe(true)
  })
})

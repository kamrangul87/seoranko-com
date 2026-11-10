import { beforeEach, describe, expect, it } from 'vitest'
import { AUTODUN_LIKE_JOBS, AUTODUN_LIKE_ORIGIN } from './autodun-like-html'
import { assembleInternalLinkMap } from './load-map'
import {
  persistEdgesFromHtml,
  resetMemoryCrawlLinkEdges,
  listCrawlLinkEdges,
  useMemoryCrawlLinkEdges,
} from './persist'
import { edgesFromStoredHtmlJobs, rebuildMissingCrawlLinkEdges } from './rebuild-edges'

describe('edgesFromStoredHtmlJobs', () => {
  it('rebuilds internal edges from stored autodun-like crawl HTML', () => {
    const edges = edgesFromStoredHtmlJobs(AUTODUN_LIKE_JOBS, AUTODUN_LIKE_ORIGIN)
    const fromHome = edges.filter((e) => e.sourceUrl === 'https://autodun.com/')
    expect(fromHome.length).toBeGreaterThanOrEqual(7)
    expect(fromHome.map((e) => e.targetUrl)).toEqual(
      expect.arrayContaining([
        'https://autodun.com/about',
        'https://autodun.com/blog',
        'https://autodun.com/blog/mot-cost-uk-2026.html',
      ]),
    )
    expect(edges.some((e) => e.targetUrl.includes('ev.autodun.com'))).toBe(false)
  })

  it('skips jobs with empty HTML rather than throwing', () => {
    const edges = edgesFromStoredHtmlJobs(
      [
        {
          url: 'https://autodun.com/empty',
          html: '',
          finalUrl: 'https://autodun.com/empty',
        },
        {
          url: 'https://autodun.com/',
          html: '<a href="/about">About</a>',
          finalUrl: 'https://autodun.com/',
        },
      ],
      AUTODUN_LIKE_ORIGIN,
    )
    expect(edges).toHaveLength(1)
    expect(edges[0]?.targetUrl).toBe('https://autodun.com/about')
  })
})

describe('rebuildMissingCrawlLinkEdges', () => {
  beforeEach(() => {
    resetMemoryCrawlLinkEdges()
    useMemoryCrawlLinkEdges()
  })

  it('does not re-extract when the run already has edges', async () => {
    await persistEdgesFromHtml({
      runId: 'run-1',
      siteId: 'site-1',
      userId: 'user-1',
      html: '<a href="/only">Only</a>',
      pageUrl: 'https://autodun.com/',
      origin: AUTODUN_LIKE_ORIGIN,
    })
    const out = await rebuildMissingCrawlLinkEdges({
      runId: 'run-1',
      siteId: 'site-1',
      userId: 'user-1',
      origin: AUTODUN_LIKE_ORIGIN,
      existingEdges: await listCrawlLinkEdges('run-1'),
      jobs: AUTODUN_LIKE_JOBS,
    })
    expect(out.rebuilt).toBe(false)
    expect(out.edges).toHaveLength(1)
    expect(out.edges[0]?.targetUrl).toBe('https://autodun.com/only')
  })

  it('persists rebuilt edges when a completed run stored HTML but saved 0 edges', async () => {
    const out = await rebuildMissingCrawlLinkEdges({
      runId: 'run-empty',
      siteId: 'site-1',
      userId: 'user-1',
      origin: AUTODUN_LIKE_ORIGIN,
      existingEdges: [],
      jobs: AUTODUN_LIKE_JOBS,
    })
    expect(out.rebuilt).toBe(true)
    expect(out.edges.length).toBeGreaterThanOrEqual(10)
    const listed = await listCrawlLinkEdges('run-empty')
    expect(listed.length).toBe(out.edges.length)

    const map = assembleInternalLinkMap({
      originUrl: AUTODUN_LIKE_ORIGIN,
      jobs: AUTODUN_LIKE_JOBS.map((j) => ({
        url: j.url,
        status: j.status,
        httpStatus: j.httpStatus,
        finalUrl: j.finalUrl,
      })),
      edges: out.edges,
    })
    expect(map.metrics.edgeCount).toBeGreaterThan(0)
    const about = map.nodes.find((n) => n.path === '/about')
    expect(about?.kind).not.toBe('orphan')
    expect(about?.depth).toBe(1)
    const home = map.nodes.find((n) => n.path === '/')
    expect(home?.outlinks).toBeGreaterThanOrEqual(4)
  })
})

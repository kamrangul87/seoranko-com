import { describe, expect, it } from 'vitest'
import { buildInternalLinkMap } from './build-map'
import type { CrawlLinkEdge, CrawlLinkPage } from './types'

const ORIGIN = 'https://example.com'

function page(
  url: string,
  extra: Partial<CrawlLinkPage> = {},
): CrawlLinkPage {
  return {
    url,
    httpStatus: 200,
    finalUrl: url,
    jobStatus: 'crawled',
    ...extra,
  }
}

function edge(
  sourceUrl: string,
  targetUrl: string,
  extra: Partial<CrawlLinkEdge> = {},
): CrawlLinkEdge {
  return {
    sourceUrl,
    targetUrl,
    hrefRaw: targetUrl,
    anchorText: 'link',
    isNofollow: false,
    targetHttpStatus: null,
    targetFinalUrl: null,
    isRedirect: false,
    ...extra,
  }
}

describe('buildInternalLinkMap', () => {
  it('sizes nodes by unique internal inlinks and walks BFS depth from the homepage', () => {
    const pages = [
      page(`${ORIGIN}/`),
      page(`${ORIGIN}/a`),
      page(`${ORIGIN}/b`),
      page(`${ORIGIN}/c`),
    ]
    const edges = [
      edge(`${ORIGIN}/`, `${ORIGIN}/a`),
      edge(`${ORIGIN}/`, `${ORIGIN}/a`, { anchorText: 'A again' }),
      edge(`${ORIGIN}/`, `${ORIGIN}/b`),
      edge(`${ORIGIN}/a`, `${ORIGIN}/c`),
    ]
    const map = buildInternalLinkMap({
      originUrl: ORIGIN,
      pages,
      edges,
    })
    const byUrl = Object.fromEntries(map.nodes.map((n) => [n.url, n]))
    expect(byUrl[`${ORIGIN}/`]?.depth).toBe(0)
    expect(byUrl[`${ORIGIN}/a`]?.depth).toBe(1)
    expect(byUrl[`${ORIGIN}/b`]?.depth).toBe(1)
    expect(byUrl[`${ORIGIN}/c`]?.depth).toBe(2)
    // Two anchors from homepage to /a still count as one unique inlink.
    expect(byUrl[`${ORIGIN}/a`]?.inlinks).toBe(1)
    expect(byUrl[`${ORIGIN}/c`]?.inlinks).toBe(1)
    expect(map.visualEdges).toHaveLength(3)
  })

  it('marks homepage-excluded pages with zero inlinks as orphans (red)', () => {
    const map = buildInternalLinkMap({
      originUrl: ORIGIN,
      pages: [page(`${ORIGIN}/`), page(`${ORIGIN}/lonely`)],
      edges: [edge(`${ORIGIN}/`, `${ORIGIN}/`)],
    })
    const lonely = map.nodes.find((n) => n.url === `${ORIGIN}/lonely`)
    const home = map.nodes.find((n) => n.url === `${ORIGIN}/`)
    expect(lonely?.kind).toBe('orphan')
    expect(lonely?.inlinks).toBe(0)
    expect(home?.kind).toBe('ok')
    expect(map.metrics.orphanCount).toBe(1)
  })

  it('marks pages more than 3 clicks from the homepage as deep (orange)', () => {
    const pages = [
      page(`${ORIGIN}/`),
      page(`${ORIGIN}/d1`),
      page(`${ORIGIN}/d2`),
      page(`${ORIGIN}/d3`),
      page(`${ORIGIN}/d4`),
    ]
    const edges = [
      edge(`${ORIGIN}/`, `${ORIGIN}/d1`),
      edge(`${ORIGIN}/d1`, `${ORIGIN}/d2`),
      edge(`${ORIGIN}/d2`, `${ORIGIN}/d3`),
      edge(`${ORIGIN}/d3`, `${ORIGIN}/d4`),
    ]
    const map = buildInternalLinkMap({ originUrl: ORIGIN, pages, edges })
    const d3 = map.nodes.find((n) => n.url === `${ORIGIN}/d3`)
    const d4 = map.nodes.find((n) => n.url === `${ORIGIN}/d4`)
    expect(d3?.depth).toBe(3)
    expect(d3?.kind).toBe('ok')
    expect(d4?.depth).toBe(4)
    expect(d4?.kind).toBe('deep')
    expect(map.metrics.deepCount).toBe(1)
  })

  it('marks broken and redirecting link targets', () => {
    const pages = [
      page(`${ORIGIN}/`),
      page(`${ORIGIN}/gone`, { httpStatus: 404, jobStatus: 'failed' }),
      page(`${ORIGIN}/old`, {
        httpStatus: 301,
        finalUrl: `${ORIGIN}/new`,
        jobStatus: 'crawled',
      }),
    ]
    const edges = [
      edge(`${ORIGIN}/`, `${ORIGIN}/gone`),
      edge(`${ORIGIN}/`, `${ORIGIN}/old`),
    ]
    const map = buildInternalLinkMap({ originUrl: ORIGIN, pages, edges })
    const gone = map.nodes.find((n) => n.url === `${ORIGIN}/gone`)
    const old = map.nodes.find((n) => n.url === `${ORIGIN}/old`)
    expect(gone?.kind).toBe('broken')
    expect(old?.kind).toBe('redirect')
    const toGone = map.visualEdges.find((e) => e.target === `${ORIGIN}/gone`)
    const toOld = map.visualEdges.find((e) => e.target === `${ORIGIN}/old`)
    expect(toGone?.broken).toBe(true)
    expect(toOld?.redirect).toBe(true)
    expect(map.metrics.brokenCount).toBe(1)
    expect(map.metrics.redirectCount).toBe(1)
  })

  it('does not treat queued/pending targets as broken while the crawl is still running', () => {
    const map = buildInternalLinkMap({
      originUrl: ORIGIN,
      pages: [
        page(`${ORIGIN}/`),
        page(`${ORIGIN}/later`, { httpStatus: null, jobStatus: 'queued' }),
      ],
      edges: [edge(`${ORIGIN}/`, `${ORIGIN}/later`)],
    })
    const later = map.nodes.find((n) => n.url === `${ORIGIN}/later`)
    expect(later?.kind).not.toBe('broken')
    expect(map.metrics.brokenCount).toBe(0)
  })

  it('ignores self-links for inlink count and reports average reachable depth', () => {
    const map = buildInternalLinkMap({
      originUrl: ORIGIN,
      pages: [page(`${ORIGIN}/`), page(`${ORIGIN}/a`)],
      edges: [
        edge(`${ORIGIN}/`, `${ORIGIN}/`),
        edge(`${ORIGIN}/`, `${ORIGIN}/a`),
      ],
    })
    const home = map.nodes.find((n) => n.url === `${ORIGIN}/`)
    expect(home?.inlinks).toBe(0)
    expect(map.metrics.averageDepth).toBe(0.5)
  })

  it('creates pending nodes for edge targets not yet in the job list (live build-up)', () => {
    const map = buildInternalLinkMap({
      originUrl: ORIGIN,
      pages: [page(`${ORIGIN}/`)],
      edges: [edge(`${ORIGIN}/`, `${ORIGIN}/next`)],
    })
    const next = map.nodes.find((n) => n.url === `${ORIGIN}/next`)
    expect(next?.crawlStatus).toBe('pending')
    expect(next?.depth).toBe(1)
  })
})

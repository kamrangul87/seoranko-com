import { describe, expect, it } from 'vitest'
import { assembleInternalLinkMap, nodeDetailForUrl, overlayEdgeStatuses } from './load-map'
import type { CrawlLinkEdge } from './types'

const ORIGIN = 'https://example.com'

describe('overlayEdgeStatuses', () => {
  it('copies the crawled target status and redirect onto edges', () => {
    const edges: CrawlLinkEdge[] = [
      {
        sourceUrl: `${ORIGIN}/`,
        targetUrl: `${ORIGIN}/old`,
        hrefRaw: '/old',
        anchorText: 'Old',
        isNofollow: false,
        targetHttpStatus: null,
        targetFinalUrl: null,
        isRedirect: false,
      },
    ]
    const out = overlayEdgeStatuses(
      edges,
      [
        {
          url: `${ORIGIN}/old`,
          httpStatus: 301,
          finalUrl: `${ORIGIN}/new`,
          jobStatus: 'crawled',
        },
      ],
      ORIGIN,
    )
    expect(out[0]?.targetHttpStatus).toBe(301)
    expect(out[0]?.isRedirect).toBe(true)
    expect(out[0]?.targetFinalUrl).toBe(`${ORIGIN}/new`)
  })
})

describe('assembleInternalLinkMap + nodeDetailForUrl', () => {
  it('builds the live graph from jobs + edges and returns inlinks/outlinks for a node', () => {
    const map = assembleInternalLinkMap({
      originUrl: ORIGIN,
      jobs: [
        { url: `${ORIGIN}/`, status: 'crawled', httpStatus: 200, finalUrl: `${ORIGIN}/` },
        { url: `${ORIGIN}/a`, status: 'crawled', httpStatus: 200, finalUrl: `${ORIGIN}/a` },
        { url: `${ORIGIN}/gone`, status: 'failed', httpStatus: 404, finalUrl: `${ORIGIN}/gone` },
      ],
      edges: [
        {
          sourceUrl: `${ORIGIN}/`,
          targetUrl: `${ORIGIN}/a`,
          hrefRaw: '/a',
          anchorText: 'A',
          isNofollow: false,
          targetHttpStatus: null,
          targetFinalUrl: null,
          isRedirect: false,
        },
        {
          sourceUrl: `${ORIGIN}/a`,
          targetUrl: `${ORIGIN}/gone`,
          hrefRaw: '/gone',
          anchorText: 'Gone',
          isNofollow: true,
          targetHttpStatus: null,
          targetFinalUrl: null,
          isRedirect: false,
        },
      ],
    })
    expect(map.metrics.brokenCount).toBe(1)
    const detail = nodeDetailForUrl(map, `${ORIGIN}/a`)
    expect(detail.node?.path).toBe('/a')
    expect(detail.inlinks).toEqual([
      expect.objectContaining({ source: `${ORIGIN}/`, anchor: 'A' }),
    ])
    expect(detail.outlinks).toEqual([
      expect.objectContaining({ target: `${ORIGIN}/gone`, nofollow: true, broken: true }),
    ])
    expect(detail.suggestions.some((s) => s.sourceUrl === `${ORIGIN}/`)).toBe(false)
  })
})

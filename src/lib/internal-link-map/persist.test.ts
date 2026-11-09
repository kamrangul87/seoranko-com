import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendCrawlLinkEdges,
  listCrawlLinkEdges,
  persistEdgesFromHtml,
  resetMemoryCrawlLinkEdges,
  useMemoryCrawlLinkEdges,
} from './persist'
import type { CrawlLinkEdge } from './types'

const EDGE: CrawlLinkEdge = {
  sourceUrl: 'https://example.com/',
  targetUrl: 'https://example.com/a',
  hrefRaw: '/a',
  anchorText: 'A',
  isNofollow: false,
  targetHttpStatus: 200,
  targetFinalUrl: 'https://example.com/a',
  isRedirect: false,
}

describe('crawl link edge persist (memory)', () => {
  beforeEach(() => {
    resetMemoryCrawlLinkEdges()
    useMemoryCrawlLinkEdges()
  })

  it('appends edges for a run and lists them back', async () => {
    await appendCrawlLinkEdges({
      runId: 'run-1',
      siteId: 'site-1',
      userId: 'user-1',
      edges: [EDGE],
    })
    const listed = await listCrawlLinkEdges('run-1')
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      sourceUrl: EDGE.sourceUrl,
      targetUrl: EDGE.targetUrl,
      anchorText: 'A',
      isNofollow: false,
    })
  })

  it('dedupes the same source/target/href on a run', async () => {
    await appendCrawlLinkEdges({
      runId: 'run-1',
      siteId: 'site-1',
      userId: 'user-1',
      edges: [EDGE, { ...EDGE, anchorText: 'A' }],
    })
    await appendCrawlLinkEdges({
      runId: 'run-1',
      siteId: 'site-1',
      userId: 'user-1',
      edges: [EDGE],
    })
    expect(await listCrawlLinkEdges('run-1')).toHaveLength(1)
  })

  it('keeps distinct anchors from the same source to the same target', async () => {
    await appendCrawlLinkEdges({
      runId: 'run-1',
      siteId: null,
      userId: 'user-1',
      edges: [EDGE, { ...EDGE, hrefRaw: '/a?ref=nav', anchorText: 'Nav A' }],
    })
    expect(await listCrawlLinkEdges('run-1')).toHaveLength(2)
  })

  it('extracts from crawled HTML and persists internal edges', async () => {
    const n = await persistEdgesFromHtml({
      runId: 'run-html',
      siteId: 'site-1',
      userId: 'user-1',
      html: '<a href="/b">Bee</a><a href="https://other.test/x">no</a>',
      pageUrl: 'https://example.com/',
      origin: 'https://example.com',
    })
    expect(n).toBe(1)
    const listed = await listCrawlLinkEdges('run-html')
    expect(listed[0]?.targetUrl).toBe('https://example.com/b')
    expect(listed[0]?.anchorText).toBe('Bee')
  })
})

import { describe, expect, it } from 'vitest'
import { suggestLinkSources } from './suggest-sources'
import type { LinkMapEdge, LinkMapNode } from './types'

function node(url: string, extra: Partial<LinkMapNode> = {}): LinkMapNode {
  return {
    url,
    path: new URL(url).pathname,
    inlinks: 0,
    outlinks: 0,
    depth: 1,
    status: 200,
    crawlStatus: 'crawled',
    kind: 'ok',
    parentUrl: 'https://example.com/',
    ...extra,
  }
}

describe('suggestLinkSources', () => {
  it('ranks pages by path-token overlap and skips pages that already link to the target', () => {
    const target = 'https://example.com/guides/ev-chargers'
    const nodes = [
      node(target),
      node('https://example.com/guides/ev-cables'),
      node('https://example.com/about'),
      node('https://example.com/guides/ev-chargers-install'),
      node('https://example.com/'),
    ]
    const edges: LinkMapEdge[] = [
      {
        source: 'https://example.com/guides/ev-cables',
        target,
        anchor: 'chargers',
        nofollow: false,
        broken: false,
        redirect: false,
      },
    ]
    const out = suggestLinkSources({
      targetUrl: target,
      nodes,
      edges,
      max: 5,
    })
    expect(out.map((s) => s.sourceUrl)).toEqual([
      'https://example.com/guides/ev-chargers-install',
      'https://example.com/',
      'https://example.com/about',
    ])
    expect(out[0]?.reason).toMatch(/topic overlap/i)
  })

  it('puts Page-2 / GSC cached sources first when they do not already link', () => {
    const target = 'https://example.com/target'
    const nodes = [
      node(target),
      node('https://example.com/blog/a'),
      node('https://example.com/blog/b'),
    ]
    const out = suggestLinkSources({
      targetUrl: target,
      nodes,
      edges: [],
      page2: {
        anchorText: 'target query',
        sources: [
          { sourceUrl: 'https://example.com/blog/b', insertion: 'related-list' },
        ],
      },
      max: 3,
    })
    expect(out[0]?.sourceUrl).toBe('https://example.com/blog/b')
    expect(out[0]?.reason).toMatch(/search console|page-2|cached/i)
    expect(out[0]?.anchorText).toBe('target query')
  })

  it('is deterministic: same inputs yield the same ordered URLs', () => {
    const target = 'https://example.com/x'
    const nodes = [
      node(target),
      node('https://example.com/b'),
      node('https://example.com/a'),
    ]
    const a = suggestLinkSources({ targetUrl: target, nodes, edges: [] })
    const b = suggestLinkSources({ targetUrl: target, nodes, edges: [] })
    expect(a.map((s) => s.sourceUrl)).toEqual(b.map((s) => s.sourceUrl))
  })
})

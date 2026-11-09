import { describe, expect, it } from 'vitest'
import { renderTreeMapSvg, treePositions } from './layout'
import type { LinkMapNode } from './types'

function n(
  url: string,
  depth: number | null,
  inlinks = 0,
): LinkMapNode {
  return {
    url,
    path: new URL(url).pathname,
    inlinks,
    outlinks: 0,
    depth,
    status: 200,
    crawlStatus: 'crawled',
    kind: depth == null ? 'orphan' : depth > 3 ? 'deep' : 'ok',
    parentUrl: null,
  }
}

describe('treePositions', () => {
  it('places the homepage above a depth-1 child and orphans on a lower row', () => {
    const home = 'https://example.com/'
    const laid = treePositions(
      [
        n(home, 0, 0),
        n('https://example.com/a', 1, 1),
        n('https://example.com/z', null, 0),
      ],
      home,
      400,
      300,
    )
    const byId = Object.fromEntries(laid.map((p) => [p.id, p]))
    expect(byId[home]!.y).toBeLessThan(byId['https://example.com/a']!.y)
    expect(byId['https://example.com/a']!.y).toBeLessThan(
      byId['https://example.com/z']!.y,
    )
  })
})

describe('renderTreeMapSvg', () => {
  it('emits an SVG with a home node and an orphan', () => {
    const home = 'https://example.com/'
    const svg = renderTreeMapSvg({
      homepageUrl: home,
      nodes: [
        n(home, 0, 2),
        n('https://example.com/a', 1, 1),
        n('https://example.com/z', null, 0),
      ],
      edges: [{ source: home, target: 'https://example.com/a' }],
    })
    expect(svg).toContain('<svg')
    expect(svg).toContain('home')
    expect(svg).toContain('#E23D28')
  })
})

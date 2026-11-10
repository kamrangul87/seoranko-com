import { describe, expect, it } from 'vitest'
import {
  boxesOverlap,
  renderTreeMapSvg,
  treePositions,
  webForceSettings,
} from './layout'
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

  it('lays out each click-depth from home on its own row', () => {
    const home = 'https://example.com/'
    const laid = treePositions(
      [
        n(home, 0, 3),
        n('https://example.com/a', 1, 2),
        n('https://example.com/b', 1, 1),
        n('https://example.com/a/c', 2, 1),
        n('https://example.com/a/c/d', 3, 1),
      ],
      home,
      800,
      400,
    )
    const y = Object.fromEntries(laid.map((p) => [p.id, p.y]))
    expect(y[home]).toBeLessThan(y['https://example.com/a']!)
    expect(y['https://example.com/a']).toBe(y['https://example.com/b'])
    expect(y['https://example.com/a']).toBeLessThan(y['https://example.com/a/c']!)
    expect(y['https://example.com/a/c']).toBeLessThan(
      y['https://example.com/a/c/d']!,
    )
  })

  it('does not overlap bounding boxes for 20 nodes on one level', () => {
    const home = 'https://example.com/'
    const nodes: LinkMapNode[] = [
      n(home, 0, 8),
      ...Array.from({ length: 20 }, (_, i) =>
        n(
          `https://example.com/blog/electric-car-charger-map-uk-${i}.html`,
          1,
          2,
        ),
      ),
    ]
    const laid = treePositions(nodes, home, 720, 640)
    const level1 = laid.filter((p) => p.id !== home)
    expect(level1).toHaveLength(20)
    for (let i = 0; i < level1.length; i++) {
      for (let j = i + 1; j < level1.length; j++) {
        expect(
          boxesOverlap(level1[i]!.box, level1[j]!.box),
          `${level1[i]!.id} overlaps ${level1[j]!.id}`,
        ).toBe(false)
      }
    }
  })
})

describe('webForceSettings', () => {
  it('scales charge to node count and keeps link distance between 80 and 120', () => {
    const small = webForceSettings(18)
    const large = webForceSettings(2000)
    expect(small.linkDistance).toBeGreaterThanOrEqual(80)
    expect(small.linkDistance).toBeLessThanOrEqual(120)
    expect(large.linkDistance).toBeGreaterThanOrEqual(80)
    expect(large.linkDistance).toBeLessThanOrEqual(120)
    expect(small.charge).toBeLessThan(0)
    expect(large.charge).toBeLessThan(0)
    expect(Math.abs(small.charge)).toBeGreaterThan(Math.abs(large.charge))
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

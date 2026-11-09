import type { LinkMapNode } from './types'

export type LaidOutNode = {
  id: string
  x: number
  y: number
  r: number
}

export function nodeRadius(inlinks: number): number {
  return 4 + Math.sqrt(Math.max(0, inlinks)) * 2.2
}

/**
 * BFS tree: homepage at the top, each click-depth on its own row.
 * Unreachable (orphan) nodes sit on a bottom row, separated from the tree.
 */
export function treePositions(
  nodes: LinkMapNode[],
  homepageUrl: string,
  width: number,
  height: number,
): LaidOutNode[] {
  const reachable = nodes.filter((n) => n.depth != null)
  const orphans = nodes.filter((n) => n.depth == null)
  const byDepth = new Map<number, LinkMapNode[]>()
  for (const n of reachable) {
    const d = n.depth ?? 0
    const list = byDepth.get(d) ?? []
    list.push(n)
    byDepth.set(d, list)
  }
  for (const list of byDepth.values()) {
    list.sort((a, b) => a.path.localeCompare(b.path))
  }
  const depths = Array.from(byDepth.keys()).sort((a, b) => a - b)
  const maxDepth = Math.max(0, ...depths)
  const rowCount = maxDepth + 1 + (orphans.length > 0 ? 1 : 0)
  const padX = 36
  const padY = 40
  const innerH = Math.max(80, height - padY * 2)
  const innerW = Math.max(80, width - padX * 2)
  const rowGap = rowCount > 1 ? innerH / Math.max(1, rowCount - 1) : 0

  const out: LaidOutNode[] = []
  for (const d of depths) {
    const row = byDepth.get(d) ?? []
    const y = padY + d * rowGap
    for (let i = 0; i < row.length; i++) {
      const n = row[i]!
      const x =
        row.length === 1
          ? padX + innerW / 2
          : padX + (i / (row.length - 1)) * innerW
      out.push({ id: n.url, x, y, r: nodeRadius(n.inlinks) })
    }
  }
  if (orphans.length > 0) {
    const y = padY + (maxDepth + 1) * rowGap
    const row = [...orphans].sort((a, b) => a.path.localeCompare(b.path))
    for (let i = 0; i < row.length; i++) {
      const n = row[i]!
      const x =
        row.length === 1
          ? padX + innerW / 2
          : padX + (i / (row.length - 1)) * innerW
      out.push({ id: n.url, x, y, r: nodeRadius(n.inlinks) })
    }
  }
  void homepageUrl
  return out
}

const SVG_FILL: Record<string, string> = {
  ok: '#FF8A4A',
  orphan: '#E23D28',
  deep: '#E08A2A',
  broken: '#C45C6A',
  redirect: '#D4A04A',
}

/** Deterministic SVG of a tree layout — used for samples and tests, not the live canvas. */
export function renderTreeMapSvg(input: {
  nodes: LinkMapNode[]
  edges: Array<{ source: string; target: string; broken?: boolean; redirect?: boolean }>
  homepageUrl: string
  width?: number
  height?: number
}): string {
  const width = input.width ?? 960
  const height = input.height ?? 640
  const laid = treePositions(input.nodes, input.homepageUrl, width, height)
  const pos = new Map(laid.map((p) => [p.id, p]))
  const byUrl = new Map(input.nodes.map((n) => [n.url, n]))
  const lines: string[] = []
  for (const e of input.edges) {
    const a = pos.get(e.source)
    const b = pos.get(e.target)
    if (!a || !b) continue
    const stroke = e.broken ? '#C45C6A' : e.redirect ? '#D4A04A' : 'rgba(255,138,74,0.35)'
    lines.push(
      `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${stroke}" stroke-width="1.2"/>`,
    )
  }
  const dots: string[] = []
  for (const p of laid) {
    const n = byUrl.get(p.id)
    const fill = SVG_FILL[n?.kind ?? 'ok']
    const label = n?.path === '/' ? 'home' : n?.path ?? ''
    dots.push(
      `<g><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(1)}" fill="${fill}"/><text x="${(p.x + p.r + 5).toFixed(1)}" y="${(p.y + 4).toFixed(1)}" fill="#F7F1EA" font-size="11" font-family="Outfit, sans-serif">${escapeXml(label)}</text></g>`,
    )
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#1C1916"/>
  ${lines.join('\n  ')}
  ${dots.join('\n  ')}
</svg>
`
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

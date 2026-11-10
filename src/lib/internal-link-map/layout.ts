import type { LinkMapNode } from './types'
import {
  estimateLabelWidth,
  LABEL_PILL_H,
  shortNodeLabel,
} from './labels'

export type LabelBox = {
  x: number
  y: number
  w: number
  h: number
}

export type LaidOutNode = {
  id: string
  x: number
  y: number
  r: number
  label: string
  box: LabelBox
}

export function nodeRadius(inlinks: number): number {
  return 4 + Math.sqrt(Math.max(0, inlinks)) * 2.2
}

export function boxesOverlap(a: LabelBox, b: LabelBox, gap = 2): boolean {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  )
}

export function webForceSettings(nodeCount: number): {
  charge: number
  linkDistance: number
  collideExtra: number
} {
  const n = Math.max(1, nodeCount)
  const charge = -Math.min(640, Math.max(140, 2200 / Math.sqrt(n)))
  const linkDistance = n <= 30 ? 120 : n <= 150 ? 100 : 80
  return { charge, linkDistance, collideExtra: 16 }
}

export function fitViewTransform(
  nodes: Array<{ x: number; y: number; r: number; box?: LabelBox }>,
  width: number,
  height: number,
  pad = 40,
): { scale: number; tx: number; ty: number } {
  if (nodes.length === 0) return { scale: 1, tx: 0, ty: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    const b =
      n.box ?? { x: n.x - n.r, y: n.y - n.r, w: n.r * 2, h: n.r * 2 }
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  const bw = Math.max(1, maxX - minX)
  const bh = Math.max(1, maxY - minY)
  const scale = Math.max(
    0.15,
    Math.min((width - pad * 2) / bw, (height - pad * 2) / bh, 1.6),
  )
  const tx = (width - bw * scale) / 2 - minX * scale
  const ty = (height - bh * scale) / 2 - minY * scale
  return { scale, tx, ty }
}

function nodeBox(x: number, y: number, r: number, label: string): LabelBox {
  const lw = estimateLabelWidth(label)
  const labelX = x - lw / 2
  const labelY = y + r + 4
  const minX = Math.min(x - r, labelX)
  const maxX = Math.max(x + r, labelX + lw)
  const minY = y - r
  const maxY = Math.max(y + r, labelY + LABEL_PILL_H)
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function avoidCollisions(laid: LaidOutNode[]): void {
  for (let pass = 0; pass < 8; pass++) {
    let moved = false
    for (let i = 0; i < laid.length; i++) {
      for (let j = i + 1; j < laid.length; j++) {
        const a = laid[i]!
        const b = laid[j]!
        if (!boxesOverlap(a.box, b.box, 4)) continue
        const dy = Math.max(8, (a.box.h + b.box.h) / 4)
        if (a.y <= b.y) {
          b.y += dy
        } else {
          a.y += dy
        }
        a.box = nodeBox(a.x, a.y, a.r, a.label)
        b.box = nodeBox(b.x, b.y, b.r, b.label)
        moved = true
      }
    }
    if (!moved) break
  }
}

/**
 * BFS tree: homepage at the top, each click-depth in its own band.
 * Wide levels wrap into extra rows so label bounding boxes do not collide.
 * Orphans sit in a band below the tree.
 */
export function treePositions(
  nodes: LinkMapNode[],
  homepageUrl: string,
  width: number,
  height: number,
): LaidOutNode[] {
  void height
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
  const padX = 36
  const padY = 40
  const innerW = Math.max(80, width - padX * 2)
  const colGap = 14
  const rowGap = 18
  const bandGap = 28

  const out: LaidOutNode[] = []
  let bandTop = padY

  const placeBand = (rowNodes: LinkMapNode[]) => {
    if (rowNodes.length === 0) return
    const items = rowNodes.map((n) => {
      const label = shortNodeLabel({ path: n.path, title: n.title })
      const r = nodeRadius(n.inlinks)
      const w = Math.max(r * 2 + 8, estimateLabelWidth(label) + 8)
      const h = r * 2 + 4 + LABEL_PILL_H
      return { n, label, r, w, h }
    })
    const slotW = Math.max(
      ...items.map((i) => i.w),
      48,
    ) + colGap
    const maxCols = Math.max(1, Math.floor((innerW + colGap) / slotW))
    const bandLaid: LaidOutNode[] = []
    let y = bandTop
    for (let start = 0; start < items.length; start += maxCols) {
      const row = items.slice(start, start + maxCols)
      const rowH = Math.max(...row.map((i) => i.h))
      const used = row.length * slotW - colGap
      const startX = padX + Math.max(0, (innerW - used) / 2)
      const cy = y + Math.max(...row.map((i) => i.r)) + 2
      for (let i = 0; i < row.length; i++) {
        const item = row[i]!
        const x = startX + i * slotW + item.w / 2
        const box = nodeBox(x, cy, item.r, item.label)
        bandLaid.push({
          id: item.n.url,
          x,
          y: cy,
          r: item.r,
          label: item.label,
          box,
        })
      }
      y += rowH + rowGap
    }
    avoidCollisions(bandLaid)
    let bottom = y
    for (const p of bandLaid) {
      bottom = Math.max(bottom, p.box.y + p.box.h)
      out.push(p)
    }
    bandTop = bottom + bandGap
  }

  for (const d of depths) {
    placeBand(byDepth.get(d) ?? [])
  }
  if (orphans.length > 0) {
    bandTop += 12
    placeBand([...orphans].sort((a, b) => a.path.localeCompare(b.path)))
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
    const cx = ((a.x + b.x) / 2 + (b.y - a.y) * 0.12).toFixed(1)
    const cy = ((a.y + b.y) / 2 - (b.x - a.x) * 0.12).toFixed(1)
    lines.push(
      `<path d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${cx} ${cy} ${b.x.toFixed(1)} ${b.y.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="1.2"/>`,
    )
  }
  const dots: string[] = []
  for (const p of laid) {
    const n = byUrl.get(p.id)
    const fill = SVG_FILL[n?.kind ?? 'ok']
    const lw = estimateLabelWidth(p.label)
    dots.push(
      `<g><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(1)}" fill="${fill}"/><rect x="${(p.x - lw / 2).toFixed(1)}" y="${(p.y + p.r + 4).toFixed(1)}" width="${lw.toFixed(1)}" height="${LABEL_PILL_H}" rx="9" fill="rgba(48,40,32,0.94)" stroke="rgba(247,241,234,0.28)"/><text x="${p.x.toFixed(1)}" y="${(p.y + p.r + 16).toFixed(1)}" text-anchor="middle" fill="#F7F1EA" font-size="11" font-family="Outfit, sans-serif">${escapeXml(p.label)}</text></g>`,
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

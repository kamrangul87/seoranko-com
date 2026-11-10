'use client'

import { useEffect, useRef, useState } from 'react'
import type { LinkMapEdge, LinkMapNode } from '@/lib/internal-link-map/types'
import {
  estimateLabelWidth,
  LABEL_PILL_H,
  shortNodeLabel,
} from '@/lib/internal-link-map/labels'
import {
  fitViewTransform,
  nodeRadius,
  treePositions,
  webForceSettings,
  type LabelBox,
} from '@/lib/internal-link-map/layout'

export type MapView = 'web' | 'tree'

const FILL: Record<LinkMapNode['kind'], string> = {
  ok: '#FF8A4A',
  orphan: '#E23D28',
  deep: '#E08A2A',
  broken: '#C45C6A',
  redirect: '#D4A04A',
}

const HUB_LABEL_CAP = 18

type SimNode = {
  id: string
  x: number
  y: number
  r: number
  kind: LinkMapNode['kind']
  path: string
  title: string | null
  label: string
  inlinks: number
  hub: boolean
  fx?: number | null
  fy?: number | null
}

type Props = {
  nodes: LinkMapNode[]
  edges: LinkMapEdge[]
  homepageUrl: string
  view: MapView
  selectedUrl: string | null
  onSelect: (url: string | null) => void
  plannedEdges?: Array<{ source: string; target: string }>
}

export function InternalLinkMapCanvas({
  nodes,
  edges,
  homepageUrl,
  view,
  selectedUrl,
  onSelect,
  plannedEdges = [],
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const selectedRef = useRef(selectedUrl)
  const plannedRef = useRef(plannedEdges)
  const drawRef = useRef<() => void>(() => {})
  const apiRef = useRef<{
    fit: () => void
    zoomBy: (factor: number, cx?: number, cy?: number) => void
  } | null>(null)
  selectedRef.current = selectedUrl
  plannedRef.current = plannedEdges

  const [tip, setTip] = useState<{ x: number; y: number; url: string } | null>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    let width = wrap.clientWidth || 640
    let height = wrap.clientHeight || 480
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      width = wrap.clientWidth || 640
      height = wrap.clientHeight || 480
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const ranked = [...nodes].sort((a, b) => b.inlinks - a.inlinks)
    const hubSet = new Set<string>()
    hubSet.add(homepageUrl)
    for (const n of ranked) {
      if (hubSet.size >= HUB_LABEL_CAP) break
      if (n.path === '/' || n.inlinks >= 3) hubSet.add(n.url)
    }

    const simNodes: SimNode[] = nodes.map((n) => ({
      id: n.url,
      x: width / 2,
      y: height / 2,
      r: nodeRadius(n.inlinks),
      kind: n.kind,
      path: n.path,
      title: n.title ?? null,
      label: shortNodeLabel({ path: n.path, title: n.title }),
      inlinks: n.inlinks,
      hub: hubSet.has(n.url) || n.path === '/',
    }))
    const byId = new Map(simNodes.map((n) => [n.id, n]))
    const simLinks = edges
      .map((e) => ({
        source: e.source,
        target: e.target,
        broken: e.broken,
        redirect: e.redirect,
        nofollow: e.nofollow,
      }))
      .filter((e) => byId.has(e.source) && byId.has(e.target))

    const settings = webForceSettings(simNodes.length)
    let scale = 1
    let tx = 0
    let ty = 0
    let hoverId: string | null = null
    let dragging: SimNode | null = null
    let panning = false
    let lastX = 0
    let lastY = 0
    let raf = 0
    let sim: { stop: () => void; alpha: (n: number) => unknown } | null = null
    let cancelled = false
    let fitted = false

    const world = (cx: number, cy: number) => ({
      x: (cx - tx) / scale,
      y: (cy - ty) / scale,
    })

    const hit = (cx: number, cy: number): SimNode | null => {
      const p = world(cx, cy)
      let best: SimNode | null = null
      let bestD = Infinity
      for (const n of simNodes) {
        const d = Math.hypot(n.x - p.x, n.y - p.y)
        if (d <= n.r + 6 / scale && d < bestD) {
          best = n
          bestD = d
        }
      }
      return best
    }

    const nodeBox = (n: SimNode): LabelBox => {
      const lw = estimateLabelWidth(n.label)
      const labelX = n.x - lw / 2
      return {
        x: Math.min(n.x - n.r, labelX),
        y: n.y - n.r,
        w: Math.max(n.r * 2, lw),
        h: n.r * 2 + 4 + LABEL_PILL_H,
      }
    }

    const fit = () => {
      const boxes = simNodes.map((n) => ({ ...n, box: nodeBox(n) }))
      const next = fitViewTransform(boxes, width, height, 36)
      scale = next.scale
      tx = next.tx
      ty = next.ty
      fitted = true
      draw()
    }

    const zoomBy = (factor: number, cx = width / 2, cy = height / 2) => {
      const next = Math.min(4, Math.max(0.2, scale * factor))
      const wx = (cx - tx) / scale
      const wy = (cy - ty) / scale
      scale = next
      tx = cx - wx * scale
      ty = cy - wy * scale
      draw()
    }
    apiRef.current = { fit, zoomBy }

    const drawCurve = (
      a: SimNode,
      b: SimNode,
      color: string,
      lineWidth: number,
      dashed: boolean,
    ) => {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const cx = (a.x + b.x) / 2 + dy * 0.14
      const cy = (a.y + b.y) / 2 - dx * 0.14
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.quadraticCurveTo(cx, cy, b.x, b.y)
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      if (dashed) ctx.setLineDash([7 / scale, 5 / scale])
      else ctx.setLineDash([])
      ctx.stroke()
      ctx.setLineDash([])
    }

    const drawPill = (n: SimNode) => {
      const lw = estimateLabelWidth(n.label)
      const x = n.x - lw / 2
      const y = n.y + n.r + 4
      const r = 9
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + lw, y, x + lw, y + LABEL_PILL_H, r)
      ctx.arcTo(x + lw, y + LABEL_PILL_H, x, y + LABEL_PILL_H, r)
      ctx.arcTo(x, y + LABEL_PILL_H, x, y, r)
      ctx.arcTo(x, y, x + lw, y, r)
      ctx.closePath()
      ctx.fillStyle = 'rgba(48,40,32,0.94)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(247,241,234,0.28)'
      ctx.lineWidth = 1 / Math.max(scale, 0.5)
      ctx.stroke()
      ctx.fillStyle = 'rgba(247,241,234,0.94)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(n.label, n.x, y + LABEL_PILL_H / 2)
    }

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#1C1916'
      ctx.fillRect(0, 0, width, height)
      ctx.save()
      ctx.translate(tx, ty)
      ctx.scale(scale, scale)

      const selected = selectedRef.current
      const adjacent = new Set<string>()
      if (selected) {
        for (const e of simLinks) {
          if (e.source === selected) adjacent.add(e.target)
          if (e.target === selected) adjacent.add(e.source)
        }
        adjacent.add(selected)
      }

      for (const e of simLinks) {
        const a = byId.get(e.source)
        const b = byId.get(e.target)
        if (!a || !b) continue
        const hot =
          selected != null && (e.source === selected || e.target === selected)
        const dim = selected != null && !hot
        let color = 'rgba(255,138,74,0.18)'
        if (e.broken) color = dim ? 'rgba(196,92,106,0.18)' : 'rgba(196,92,106,0.7)'
        else if (e.redirect) color = dim ? 'rgba(212,160,74,0.16)' : 'rgba(212,160,74,0.65)'
        else if (hot) color = 'rgba(255,138,74,0.85)'
        else if (dim) color = 'rgba(255,138,74,0.06)'
        drawCurve(
          a,
          b,
          color,
          (hot ? 1.8 : e.nofollow ? 0.7 : 1.05) / scale,
          e.broken || e.redirect || e.nofollow,
        )
      }

      for (const e of plannedRef.current) {
        const a = byId.get(e.source)
        const b = byId.get(e.target)
        if (!a || !b) continue
        drawCurve(a, b, 'rgba(255,107,44,0.72)', 1.2 / scale, true)
      }

      for (const n of simNodes) {
        const dim =
          selected != null && n.id !== selected && !adjacent.has(n.id)
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.globalAlpha = dim ? 0.28 : 1
        ctx.fillStyle = FILL[n.kind]
        ctx.fill()
        ctx.globalAlpha = 1
        if (n.id === selected || n.id === hoverId) {
          ctx.lineWidth = 2 / scale
          ctx.strokeStyle = '#F7F1EA'
          ctx.stroke()
        }
      }

      ctx.font = `500 ${11}px Outfit, sans-serif`
      const showAll = scale > 1
      const vx0 = -tx / scale
      const vy0 = -ty / scale
      const vx1 = (width - tx) / scale
      const vy1 = (height - ty) / scale
      let drawn = 0
      for (const n of simNodes) {
        const always = n.id === hoverId || n.id === selected || n.hub
        if (!always && !showAll) continue
        if (
          n.x < vx0 - 40 ||
          n.x > vx1 + 40 ||
          n.y < vy0 - 40 ||
          n.y > vy1 + 40
        ) {
          continue
        }
        if (!always && drawn > 80) continue
        drawPill(n)
        drawn += 1
      }
      ctx.restore()
    }
    drawRef.current = draw

    const applyTree = () => {
      const laid = treePositions(nodes, homepageUrl, Math.max(width, 720), Math.max(height, 640))
      for (const p of laid) {
        const n = byId.get(p.id)
        if (!n) continue
        n.x = p.x
        n.y = p.y
        n.r = p.r
        n.label = p.label
        n.fx = p.x
        n.fy = p.y
      }
    }

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const start = async () => {
      if (view === 'tree') {
        applyTree()
        fit()
        return
      }
      const d3 = await import('d3-force')
      if (cancelled) return
      const forceLinks = simLinks.map((l) => ({ ...l }))
      const collideR = (d: SimNode) =>
        d.r + settings.collideExtra + (d.hub ? estimateLabelWidth(d.label) * 0.45 : 4)
      const simulation = d3
        .forceSimulation(simNodes)
        .force(
          'link',
          d3
            .forceLink(forceLinks)
            .id((d) => (d as SimNode).id)
            .distance(settings.linkDistance)
            .strength(0.55),
        )
        .force('charge', d3.forceManyBody().strength(settings.charge).theta(0.9))
        .force('center', d3.forceCenter(width / 2, height / 2).strength(0.04))
        .force(
          'collide',
          d3.forceCollide<SimNode>(collideR).iterations(simNodes.length > 400 ? 1 : 2),
        )
        .alpha(1)
        .alphaDecay(simNodes.length > 400 ? 0.05 : 0.028)
      sim = simulation
      const ticks = reduced ? 120 : simNodes.length > 800 ? 180 : 280
      if (reduced || simNodes.length > 1200) {
        simulation.stop()
        simulation.tick(ticks)
        fit()
        return
      }
      simulation.on('tick', () => {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(draw)
      })
      simulation.on('end', () => {
        if (!fitted) fit()
      })
    }
    void start()

    const onMove = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const cx = ev.clientX - rect.left
      const cy = ev.clientY - rect.top
      if (panning) {
        tx += cx - lastX
        ty += cy - lastY
        lastX = cx
        lastY = cy
        draw()
        return
      }
      if (dragging) {
        const p = world(cx, cy)
        dragging.fx = p.x
        dragging.fy = p.y
        dragging.x = p.x
        dragging.y = p.y
        sim?.alpha(0.2)
        draw()
        return
      }
      const n = hit(cx, cy)
      const next = n?.id ?? null
      if (next !== hoverId) {
        hoverId = next
        canvas.style.cursor = next ? 'pointer' : 'grab'
        setTip(n ? { x: cx + 12, y: cy + 12, url: n.id } : null)
        draw()
      } else if (n) {
        setTip({ x: cx + 12, y: cy + 12, url: n.id })
      }
    }
    const onDown = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      lastX = ev.clientX - rect.left
      lastY = ev.clientY - rect.top
      const n = hit(lastX, lastY)
      if (n) {
        dragging = n
        n.fx = n.x
        n.fy = n.y
        canvas.setPointerCapture(ev.pointerId)
      } else {
        panning = true
        canvas.setPointerCapture(ev.pointerId)
      }
    }
    const onUp = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const cx = ev.clientX - rect.left
      const cy = ev.clientY - rect.top
      const n = hit(cx, cy)
      if (dragging && n && n.id === dragging.id) {
        onSelect(n.id === selectedRef.current ? null : n.id)
      }
      if (dragging && view === 'web') {
        dragging.fx = null
        dragging.fy = null
      }
      dragging = null
      panning = false
    }
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const cx = ev.clientX - rect.left
      const cy = ev.clientY - rect.top
      zoomBy(ev.deltaY < 0 ? 1.08 : 0.92, cx, cy)
    }
    const onResize = () => {
      resize()
      if (view === 'tree') applyTree()
      fit()
    }

    const onLeave = () => {
      hoverId = null
      setTip(null)
      draw()
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    const ro = new ResizeObserver(onResize)
    ro.observe(wrap)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      sim?.stop()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
      ro.disconnect()
    }
  }, [nodes, edges, homepageUrl, view, onSelect])

  useEffect(() => {
    drawRef.current()
  }, [selectedUrl, plannedEdges])

  return (
    <div ref={wrapRef} className="relative h-full w-full min-h-[28rem]">
      <canvas
        ref={canvasRef}
        className="block h-full w-full rounded-md touch-none"
        aria-label="Internal link map"
      />
      <div className="absolute bottom-3 left-3 flex gap-1">
        <button
          type="button"
          className="h-8 min-w-[2rem] rounded-md bg-[#14110E]/80 text-[#F7F1EA] text-sm px-2 border border-white/10 hover:bg-[#14110E]"
          onClick={() => apiRef.current?.zoomBy(0.85)}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="h-8 min-w-[2rem] rounded-md bg-[#14110E]/80 text-[#F7F1EA] text-sm px-2 border border-white/10 hover:bg-[#14110E]"
          onClick={() => apiRef.current?.zoomBy(1.15)}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="h-8 rounded-md bg-[#14110E]/80 text-[#F7F1EA] text-xs px-3 border border-white/10 hover:bg-[#14110E]"
          onClick={() => apiRef.current?.fit()}
        >
          Fit
        </button>
      </div>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 max-w-xs rounded-md bg-[#14110E] text-[#F7F1EA] text-xs px-2 py-1.5 shadow-lg border border-white/10 break-all"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.url}
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useRef } from 'react'
import type { LinkMapEdge, LinkMapNode } from '@/lib/internal-link-map/types'
import { nodeRadius, treePositions } from '@/lib/internal-link-map/layout'

export type MapView = 'web' | 'tree'

const FILL: Record<LinkMapNode['kind'], string> = {
  ok: '#FF8A4A',
  orphan: '#E23D28',
  deep: '#E08A2A',
  broken: '#C45C6A',
  redirect: '#D4A04A',
}

const LABEL_CAP = 28

type SimNode = {
  id: string
  x: number
  y: number
  r: number
  kind: LinkMapNode['kind']
  path: string
  inlinks: number
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
  selectedRef.current = selectedUrl
  plannedRef.current = plannedEdges

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

    const simNodes: SimNode[] = nodes.map((n) => ({
      id: n.url,
      x: width / 2,
      y: height / 2,
      r: nodeRadius(n.inlinks),
      kind: n.kind,
      path: n.path,
      inlinks: n.inlinks,
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

    const labelSet = new Set<string>()
    labelSet.add(homepageUrl)
    const ranked = [...simNodes].sort((a, b) => b.inlinks - a.inlinks)
    for (const n of ranked) {
      if (labelSet.size >= LABEL_CAP) break
      if (n.path === '/' || n.inlinks >= 2) labelSet.add(n.id)
    }

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
        if (d <= n.r + 4 / scale && d < bestD) {
          best = n
          bestD = d
        }
      }
      return best
    }

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#1C1916'
      ctx.fillRect(0, 0, width, height)
      ctx.save()
      ctx.translate(tx, ty)
      ctx.scale(scale, scale)

      for (const e of simLinks) {
        const a = byId.get(e.source)
        const b = byId.get(e.target)
        if (!a || !b) continue
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = e.broken
          ? 'rgba(196,92,106,0.7)'
          : e.redirect
            ? 'rgba(212,160,74,0.65)'
            : 'rgba(255,138,74,0.22)'
        ctx.lineWidth = (e.nofollow ? 0.7 : 1.1) / scale
        if (e.broken || e.redirect || e.nofollow) {
          ctx.setLineDash([4 / scale, 4 / scale])
        } else {
          ctx.setLineDash([])
        }
        ctx.stroke()
      }
      ctx.setLineDash([])

      for (const e of plannedRef.current) {
        const a = byId.get(e.source)
        const b = byId.get(e.target)
        if (!a || !b) continue
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = 'rgba(255,107,44,0.7)'
        ctx.lineWidth = 1.15 / scale
        ctx.setLineDash([7 / scale, 5 / scale])
        ctx.stroke()
      }
      ctx.setLineDash([])

      for (const n of simNodes) {
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fillStyle = FILL[n.kind]
        ctx.fill()
        if (n.id === selectedRef.current || n.id === hoverId) {
          ctx.lineWidth = 2 / scale
          ctx.strokeStyle = '#F7F1EA'
          ctx.stroke()
        }
      }

      ctx.font = `${11 / scale}px Outfit, sans-serif`
      ctx.fillStyle = 'rgba(247,241,234,0.88)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const show = new Set(labelSet)
      if (hoverId) show.add(hoverId)
      if (selectedRef.current) show.add(selectedRef.current)
      if (show.size <= 80) {
        for (const n of simNodes) {
          if (!show.has(n.id)) continue
          const label = n.path === '/' ? 'home' : n.path
          ctx.fillText(label, n.x + n.r + 4 / scale, n.y)
        }
      }
      ctx.restore()
    }
    drawRef.current = draw

    const applyTree = () => {
      const laid = treePositions(nodes, homepageUrl, width, height)
      for (const p of laid) {
        const n = byId.get(p.id)
        if (!n) continue
        n.x = p.x
        n.y = p.y
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
        draw()
        return
      }
      const d3 = await import('d3-force')
      if (cancelled) return
      const forceLinks = simLinks.map((l) => ({ ...l }))
      const simulation = d3
        .forceSimulation(simNodes)
        .force(
          'link',
          d3
            .forceLink(forceLinks)
            .id((d) => (d as SimNode).id)
            .distance(42)
            .strength(0.4),
        )
        .force('charge', d3.forceManyBody().strength(-80).theta(0.9))
        .force('center', d3.forceCenter(width / 2, height / 2).strength(0.05))
        .force(
          'collide',
          d3.forceCollide<SimNode>((d) => d.r + 2).iterations(1),
        )
        .alpha(1)
      sim = simulation
      if (reduced) {
        simulation.stop()
        simulation.tick(80)
        draw()
        return
      }
      simulation.on('tick', () => {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(draw)
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
        draw()
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
      const factor = ev.deltaY < 0 ? 1.08 : 0.92
      const next = Math.min(4, Math.max(0.25, scale * factor))
      const wx = (cx - tx) / scale
      const wy = (cy - ty) / scale
      scale = next
      tx = cx - wx * scale
      ty = cy - wy * scale
      draw()
    }
    const onResize = () => {
      resize()
      if (view === 'tree') applyTree()
      draw()
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
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
        className="block h-full w-full rounded-md"
        aria-label="Internal link map"
      />
    </div>
  )
}

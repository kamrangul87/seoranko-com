/**
 * Crawlable internal link graph for topics 43 and 45.
 *
 * Only `<a href>` with a resolvable URI reduces depth / counts as inbound (N1).
 * `onclick` and `javascript:` do NOT (N3). JS-rendered real `<a href>` edges
 * may be supplied separately and are flagged render-required (N4).
 *
 * On client-rendered sites, served HTML may yield no graph — report
 * `client_only` honestly rather than false orphans (topic 67).
 */

import { parseHtml } from './html-parser'
import { normalizeFixStrategyUrl } from './url-normalize'
import { presenceAfterServedHtml, type ContentPresenceState } from '../fetch/content-presence'

export type LinkGraphPageInput = {
  url: string
  /** Served HTML (topic 67). */
  html: string
  status?: number | null
  hasNoindex?: boolean
  /** Intentionally unlinked campaign/landing — human-review for orphans. */
  campaignLanding?: boolean
  /** Listed in XML sitemap (still orphaned in graph; lower severity). */
  inSitemap?: boolean
}

/** Optional edges seen only after JS render (real `<a href>`). */
export type RenderedLinkEdge = {
  fromUrl: string
  toUrl: string
}

export type LinkGraphEdge = {
  fromNormalized: string
  toNormalized: string
  crawlable: boolean
  /** True when edge came from rendered DOM, not served HTML. */
  renderRequired: boolean
  /** Non-crawlable reason when crawlable=false. */
  nonCrawlableKind: 'onclick' | 'javascript' | null
}

export type LinkGraphNode = {
  url: string
  urlNormalized: string
  status: number | null
  hasNoindex: boolean
  campaignLanding: boolean
  inSitemap: boolean
  /** Inbound crawlable edges (served + render-required). */
  inboundCrawlableCount: number
  /** Inbound that required render. */
  inboundRenderRequiredCount: number
  /** Inbound non-crawlable only (onclick / javascript:). */
  inboundNonCrawlableCount: number
  /**
   * Shortest click depth from homepage via crawlable links only.
   * null = undefined (orphan / unreachable) — topic 43, not infinite.
   */
  depth: number | null
  /** Shortest path of normalized URLs from homepage (inclusive). */
  shortestPath: string[] | null
  /** True when depth path used at least one render-required edge. */
  pathUsedRenderRequired: boolean
}

export type InternalLinkGraph = {
  originUrl: string
  homepageNormalized: string
  nodes: LinkGraphNode[]
  edges: LinkGraphEdge[]
  /**
   * Served HTML produced no crawlable internal edges site-wide.
   * Topics 43/45 must report this rather than false orphans.
   */
  clientOnlyGraph: boolean
  graphPresence: ContentPresenceState
}

export type BuildLinkGraphOptions = {
  originUrl: string
  /** Assumed site root for depth. Stated in findings when used. */
  homepageUrl?: string
  pages: LinkGraphPageInput[]
  /** Extra crawlable edges from rendered DOM (N4). */
  renderedEdges?: RenderedLinkEdge[]
}

function isJavascriptHref(href: string): boolean {
  return href.trim().toLowerCase().startsWith('javascript:')
}

function isSkippableScheme(href: string): boolean {
  const t = href.trim().toLowerCase()
  if (!t || t === '#') return true
  if (t.startsWith('#')) return true
  if (t.startsWith('mailto:') || t.startsWith('tel:') || t.startsWith('data:')) {
    return true
  }
  return false
}

/**
 * Extract crawlable and non-crawlable internal link signals from one page.
 */
export function extractPageLinkSignals(
  html: string,
  pageUrl: string,
): {
  crawlable: Array<{ href: string; normalized: string }>
  nonCrawlable: Array<{ kind: 'onclick' | 'javascript'; href: string | null }>
} {
  const parsed = parseHtml(html)
  const crawlable: Array<{ href: string; normalized: string }> = []
  const nonCrawlable: Array<{
    kind: 'onclick' | 'javascript'
    href: string | null
  }> = []
  const seenCrawlable = new Set<string>()

  for (const el of [
    ...parsed.headElements('a'),
    ...parsed.bodyElements('a'),
  ]) {
    const href = el.attrs.href?.trim() ?? ''
    const hasOnclick = Boolean(el.attrs.onclick?.trim())

    if (!href) {
      if (hasOnclick) {
        nonCrawlable.push({ kind: 'onclick', href: null })
      }
      continue
    }

    if (isJavascriptHref(href)) {
      nonCrawlable.push({ kind: 'javascript', href })
      continue
    }

    if (isSkippableScheme(href)) continue

    let resolved: URL
    try {
      resolved = new URL(href, pageUrl)
    } catch {
      continue
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue
    let pageHost: string
    try {
      pageHost = new URL(pageUrl).host
    } catch {
      continue
    }
    if (resolved.host !== pageHost) continue

    const normalized = normalizeFixStrategyUrl(resolved.href, pageUrl)
    if (!normalized) continue
    if (seenCrawlable.has(normalized)) continue
    seenCrawlable.add(normalized)
    crawlable.push({ href, normalized })
  }

  return { crawlable, nonCrawlable }
}

/**
 * Build the crawlable internal link graph from served HTML (+ optional render edges).
 */
export function buildInternalLinkGraph(
  options: BuildLinkGraphOptions,
): InternalLinkGraph {
  const originNorm =
    normalizeFixStrategyUrl(options.originUrl) ?? options.originUrl
  const homepageRaw = options.homepageUrl ?? options.originUrl
  const homepageNormalized =
    normalizeFixStrategyUrl(homepageRaw, options.originUrl) ?? homepageRaw

  const nodeMap = new Map<string, LinkGraphNode>()
  const edges: LinkGraphEdge[] = []
  const adjacency = new Map<
    string,
    Array<{ to: string; renderRequired: boolean }>
  >()

  const ensureNode = (input: LinkGraphPageInput | { url: string }) => {
    const norm =
      normalizeFixStrategyUrl(input.url, options.originUrl) ?? input.url
    let node = nodeMap.get(norm)
    if (!node) {
      const full = input as LinkGraphPageInput
      node = {
        url: input.url,
        urlNormalized: norm,
        status: full.status ?? null,
        hasNoindex: full.hasNoindex ?? false,
        campaignLanding: full.campaignLanding ?? false,
        inSitemap: full.inSitemap ?? false,
        inboundCrawlableCount: 0,
        inboundRenderRequiredCount: 0,
        inboundNonCrawlableCount: 0,
        depth: null,
        shortestPath: null,
        pathUsedRenderRequired: false,
      }
      nodeMap.set(norm, node)
    } else if ('status' in input && input.status != null) {
      node.status = input.status
      node.hasNoindex = input.hasNoindex ?? node.hasNoindex
      node.campaignLanding = input.campaignLanding ?? node.campaignLanding
      node.inSitemap = input.inSitemap ?? node.inSitemap
    }
    return node
  }

  for (const page of options.pages) {
    ensureNode(page)
  }
  // Ensure homepage node exists
  ensureNode({ url: homepageRaw })

  let servedCrawlableEdgeCount = 0

  for (const page of options.pages) {
    const fromNorm =
      normalizeFixStrategyUrl(page.url, options.originUrl) ?? page.url
    const signals = extractPageLinkSignals(page.html, page.url)

    for (const c of signals.crawlable) {
      ensureNode({ url: c.normalized })
      edges.push({
        fromNormalized: fromNorm,
        toNormalized: c.normalized,
        crawlable: true,
        renderRequired: false,
        nonCrawlableKind: null,
      })
      servedCrawlableEdgeCount += 1
      const list = adjacency.get(fromNorm) ?? []
      list.push({ to: c.normalized, renderRequired: false })
      adjacency.set(fromNorm, list)
    }

    for (const nc of signals.nonCrawlable) {
      // Non-crawlable inbound is attributed when we know a target — onclick
      // without href has no target; javascript: may encode a path we cannot
      // trust. Count against source page's outbound only for diagnostics;
      // inbound non-crawlable is recorded when target is known via data attrs
      // or when callers pass explicit mappings. For fixtures, onclick pointing
      // is supplied via renderedEdges=false path using a data-href convention:
      if (nc.kind === 'javascript' && nc.href) {
        // Do not add to adjacency (does not reduce depth).
        edges.push({
          fromNormalized: fromNorm,
          toNormalized: fromNorm, // placeholder; no real target
          crawlable: false,
          renderRequired: false,
          nonCrawlableKind: 'javascript',
        })
      } else if (nc.kind === 'onclick') {
        edges.push({
          fromNormalized: fromNorm,
          toNormalized: fromNorm,
          crawlable: false,
          renderRequired: false,
          nonCrawlableKind: 'onclick',
        })
      }
    }
  }

  // Explicit non-crawlable inbound targets (fixtures / richer extractors)
  // via pages that only have onclick toward a known URL — passed as
  // renderedEdges with a marker? Better: accept optional nonCrawlableInbound.
  // For simplicity, count non-crawlable inbound via a side channel on options.

  for (const re of options.renderedEdges ?? []) {
    const fromNorm =
      normalizeFixStrategyUrl(re.fromUrl, options.originUrl) ?? re.fromUrl
    const toNorm =
      normalizeFixStrategyUrl(re.toUrl, options.originUrl) ?? re.toUrl
    ensureNode({ url: re.fromUrl })
    ensureNode({ url: re.toUrl })
    edges.push({
      fromNormalized: fromNorm,
      toNormalized: toNorm,
      crawlable: true,
      renderRequired: true,
      nonCrawlableKind: null,
    })
    const list = adjacency.get(fromNorm) ?? []
    list.push({ to: toNorm, renderRequired: true })
    adjacency.set(fromNorm, list)
  }

  // Inbound counts
  for (const e of edges) {
    if (!e.crawlable) continue
    if (e.fromNormalized === e.toNormalized && e.nonCrawlableKind) continue
    const target = nodeMap.get(e.toNormalized)
    if (!target) continue
    // Self-links don't count as inbound from "another" page for orphan (N7)
    if (e.fromNormalized === e.toNormalized) continue
    target.inboundCrawlableCount += 1
    if (e.renderRequired) target.inboundRenderRequiredCount += 1
  }

  // BFS shortest path from homepage (crawlable edges only)
  type BfsState = {
    path: string[]
    usedRender: boolean
  }
  const visited = new Map<string, BfsState>()
  const queue: string[] = []
  visited.set(homepageNormalized, {
    path: [homepageNormalized],
    usedRender: false,
  })
  queue.push(homepageNormalized)

  while (queue.length > 0) {
    const cur = queue.shift()!
    const state = visited.get(cur)!
    for (const next of adjacency.get(cur) ?? []) {
      if (visited.has(next.to)) continue
      visited.set(next.to, {
        path: [...state.path, next.to],
        usedRender: state.usedRender || next.renderRequired,
      })
      queue.push(next.to)
    }
  }

  for (const node of nodeMap.values()) {
    const st = visited.get(node.urlNormalized)
    if (st) {
      node.depth = st.path.length - 1
      node.shortestPath = st.path
      node.pathUsedRenderRequired = st.usedRender
    } else {
      node.depth = null
      node.shortestPath = null
    }
  }

  const clientOnlyGraph =
    options.pages.length > 0 && servedCrawlableEdgeCount === 0

  return {
    originUrl: originNorm,
    homepageNormalized,
    nodes: Array.from(nodeMap.values()),
    edges,
    clientOnlyGraph,
    graphPresence: presenceAfterServedHtml(servedCrawlableEdgeCount > 0),
  }
}

/**
 * Record that a page is reachable only via non-crawlable controls from `from`.
 * Does not add crawlable edges (does not reduce depth / clear orphan).
 */
export function recordNonCrawlableInbound(
  graph: InternalLinkGraph,
  targetUrl: string,
  kind: 'onclick' | 'javascript',
): void {
  const norm =
    normalizeFixStrategyUrl(targetUrl, graph.originUrl) ?? targetUrl
  const node = graph.nodes.find((n) => n.urlNormalized === norm)
  if (!node) return
  node.inboundNonCrawlableCount += 1
  graph.edges.push({
    fromNormalized: graph.homepageNormalized,
    toNormalized: norm,
    crawlable: false,
    renderRequired: false,
    nonCrawlableKind: kind,
  })
}

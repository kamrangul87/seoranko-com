/**
 * Force/tree-ready internal link graph from persisted crawl edges + job statuses.
 * Depth is BFS click-distance from the homepage. No network.
 */

import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared'
import type {
  CrawlJobStatus,
  CrawlLinkEdge,
  CrawlLinkPage,
  InternalLinkMap,
  LinkMapEdge,
  LinkMapNode,
  LinkMapNodeKind,
} from './types'

const DEEP_CLICKS = 3

export type BuildInternalLinkMapInput = {
  originUrl: string
  pages: CrawlLinkPage[]
  edges: CrawlLinkEdge[]
  homepageUrl?: string
  titles?: Map<string, string | null>
}

function norm(url: string, base?: string): string {
  return normalizeFixStrategyUrl(url, base) ?? url
}

function pathOf(url: string): string {
  try {
    const u = new URL(url)
    return `${u.pathname}${u.search}` || '/'
  } catch {
    return url
  }
}

function isBrokenStatus(
  httpStatus: number | null,
  jobStatus: CrawlJobStatus,
): boolean {
  if (jobStatus === 'failed') return true
  if (httpStatus == null) return false
  return httpStatus >= 400
}

function isRedirectPage(
  url: string,
  httpStatus: number | null,
  finalUrl: string | null,
): boolean {
  if (httpStatus != null && httpStatus >= 300 && httpStatus < 400) return true
  if (!finalUrl) return false
  return norm(finalUrl, url) !== norm(url)
}

function nodeKind(input: {
  isHome: boolean
  inlinks: number
  depth: number | null
  broken: boolean
  redirect: boolean
}): LinkMapNodeKind {
  if (input.broken) return 'broken'
  if (input.redirect) return 'redirect'
  if (!input.isHome && input.inlinks === 0) return 'orphan'
  if (input.depth != null && input.depth > DEEP_CLICKS) return 'deep'
  return 'ok'
}

export function buildInternalLinkMap(
  input: BuildInternalLinkMapInput,
): InternalLinkMap {
  const homepageUrl = norm(input.homepageUrl ?? input.originUrl, input.originUrl)

  type Acc = {
    url: string
    status: number | null
    finalUrl: string | null
    crawlStatus: CrawlJobStatus
    inSources: Set<string>
    outTargets: Set<string>
  }
  const nodes = new Map<string, Acc>()

  const ensure = (
    url: string,
    extra?: Partial<Pick<Acc, 'status' | 'finalUrl' | 'crawlStatus'>>,
  ): Acc => {
    const key = norm(url, input.originUrl)
    let n = nodes.get(key)
    if (!n) {
      n = {
        url: key,
        status: extra?.status ?? null,
        finalUrl: extra?.finalUrl ?? null,
        crawlStatus: extra?.crawlStatus ?? 'pending',
        inSources: new Set(),
        outTargets: new Set(),
      }
      nodes.set(key, n)
    } else if (extra) {
      if (extra.status != null) n.status = extra.status
      if (extra.finalUrl != null) n.finalUrl = extra.finalUrl
      if (extra.crawlStatus && extra.crawlStatus !== 'pending') {
        n.crawlStatus = extra.crawlStatus
      }
    }
    return n
  }

  ensure(homepageUrl, { crawlStatus: 'pending' })
  for (const p of input.pages) {
    ensure(p.url, {
      status: p.httpStatus,
      finalUrl: p.finalUrl,
      crawlStatus: p.jobStatus,
    })
  }

  const rawEdges: LinkMapEdge[] = []
  const visualKey = new Set<string>()
  const visualEdges: LinkMapEdge[] = []
  const adjacency = new Map<string, string[]>()

  for (const e of input.edges) {
    const source = norm(e.sourceUrl, input.originUrl)
    const target = norm(e.targetUrl, input.originUrl)
    const from = ensure(source)
    const to = ensure(target)
    if (source !== target) {
      from.outTargets.add(target)
      to.inSources.add(source)
      const list = adjacency.get(source) ?? []
      if (!list.includes(target)) list.push(target)
      adjacency.set(source, list)
    }

    const targetBroken = isBrokenStatus(to.status, to.crawlStatus)
    const targetRedirect =
      !targetBroken && isRedirectPage(to.url, to.status, to.finalUrl)
    const mapped: LinkMapEdge = {
      source,
      target,
      anchor: e.anchorText,
      nofollow: e.isNofollow || false,
      broken: targetBroken,
      redirect: targetRedirect || e.isRedirect,
    }
    rawEdges.push(mapped)
    const vk = `${source}\0${target}`
    if (!visualKey.has(vk)) {
      visualKey.add(vk)
      visualEdges.push(mapped)
    }
  }

  const parent = new Map<string, string | null>()
  const depth = new Map<string, number>()
  const queue: string[] = []
  depth.set(homepageUrl, 0)
  parent.set(homepageUrl, null)
  queue.push(homepageUrl)
  while (queue.length > 0) {
    const cur = queue.shift()!
    const d = depth.get(cur) ?? 0
    for (const next of adjacency.get(cur) ?? []) {
      if (depth.has(next)) continue
      depth.set(next, d + 1)
      parent.set(next, cur)
      queue.push(next)
    }
  }

  const outNodes: LinkMapNode[] = []
  for (const n of nodes.values()) {
    const isHome = n.url === homepageUrl
    const inlinks = n.inSources.size
    const d = depth.has(n.url) ? depth.get(n.url)! : null
    const broken = isBrokenStatus(n.status, n.crawlStatus)
    const redirect = !broken && isRedirectPage(n.url, n.status, n.finalUrl)
    outNodes.push({
      url: n.url,
      path: pathOf(n.url),
      title: input.titles?.get(n.url) ?? null,
      inlinks,
      outlinks: n.outTargets.size,
      depth: d,
      status: n.status,
      crawlStatus: n.crawlStatus,
      kind: nodeKind({ isHome, inlinks, depth: d, broken, redirect }),
      parentUrl: parent.has(n.url) ? parent.get(n.url)! : null,
    })
  }

  const depths = outNodes
    .map((n) => n.depth)
    .filter((d): d is number => d != null)
  const averageDepth =
    depths.length === 0
      ? null
      : depths.reduce((a, b) => a + b, 0) / depths.length

  return {
    homepageUrl,
    nodes: outNodes,
    edges: rawEdges,
    visualEdges,
    metrics: {
      nodeCount: outNodes.length,
      edgeCount: visualEdges.length,
      orphanCount: outNodes.filter((n) => n.kind === 'orphan').length,
      deepCount: outNodes.filter((n) => n.kind === 'deep').length,
      brokenCount: visualEdges.filter((e) => e.broken).length,
      redirectCount: visualEdges.filter((e) => e.redirect).length,
      averageDepth,
    },
  }
}

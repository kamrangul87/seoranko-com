import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared'
import { buildInternalLinkMap } from './build-map'
import { suggestLinkSources } from './suggest-sources'
import type {
  CrawlJobStatus,
  CrawlLinkEdge,
  CrawlLinkPage,
  InternalLinkMap,
  LinkSourceSuggestion,
  Page2LinkCache,
} from './types'

function norm(url: string, base?: string): string {
  return normalizeFixStrategyUrl(url, base) ?? url
}

export type SlimCrawlJob = {
  url: string
  status: string
  httpStatus: number | null
  finalUrl: string | null
}

const JOB_STATUSES: CrawlJobStatus[] = [
  'queued',
  'running',
  'crawled',
  'failed',
  'client_only',
  'skipped',
  'pending',
]

export function pagesFromSlimJobs(jobs: SlimCrawlJob[]): CrawlLinkPage[] {
  return jobs.map((j) => ({
    url: j.url,
    httpStatus: j.httpStatus,
    finalUrl: j.finalUrl,
    jobStatus: (JOB_STATUSES.includes(j.status as CrawlJobStatus)
      ? j.status
      : 'pending') as CrawlJobStatus,
  }))
}

export function overlayEdgeStatuses(
  edges: CrawlLinkEdge[],
  pages: CrawlLinkPage[],
  originUrl: string,
): CrawlLinkEdge[] {
  const byUrl = new Map<string, CrawlLinkPage>()
  for (const p of pages) {
    byUrl.set(norm(p.url, originUrl), p)
    if (p.finalUrl) byUrl.set(norm(p.finalUrl, originUrl), p)
  }
  return edges.map((e) => {
    const page = byUrl.get(norm(e.targetUrl, originUrl))
    if (!page) return e
    const finalUrl = page.finalUrl
    const isRedirect =
      (page.httpStatus != null &&
        page.httpStatus >= 300 &&
        page.httpStatus < 400) ||
      (finalUrl != null && norm(finalUrl, originUrl) !== norm(page.url, originUrl))
    return {
      ...e,
      targetHttpStatus: page.httpStatus,
      targetFinalUrl: finalUrl,
      isRedirect,
    }
  })
}

export function assembleInternalLinkMap(input: {
  originUrl: string
  jobs: SlimCrawlJob[]
  edges: CrawlLinkEdge[]
  homepageUrl?: string
}): InternalLinkMap {
  const pages = pagesFromSlimJobs(input.jobs)
  const edges = overlayEdgeStatuses(input.edges, pages, input.originUrl)
  return buildInternalLinkMap({
    originUrl: input.originUrl,
    homepageUrl: input.homepageUrl,
    pages,
    edges,
  })
}

export function nodeDetailForUrl(
  map: InternalLinkMap,
  url: string,
  page2?: Page2LinkCache | null,
): {
  node: InternalLinkMap['nodes'][number] | null
  inlinks: InternalLinkMap['edges']
  outlinks: InternalLinkMap['edges']
  suggestions: LinkSourceSuggestion[]
} {
  const target = norm(url, map.homepageUrl)
  const node = map.nodes.find((n) => n.url === target) ?? null
  const inlinks = map.edges.filter((e) => e.target === target)
  const outlinks = map.edges.filter((e) => e.source === target)
  const suggestions = node
    ? suggestLinkSources({
        targetUrl: target,
        nodes: map.nodes,
        edges: map.visualEdges,
        page2,
      })
    : []
  return { node, inlinks, outlinks, suggestions }
}

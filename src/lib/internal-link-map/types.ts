export type CrawlJobStatus =
  | 'queued'
  | 'running'
  | 'crawled'
  | 'failed'
  | 'client_only'
  | 'skipped'
  | 'pending'

export type CrawlLinkPage = {
  url: string
  httpStatus: number | null
  finalUrl: string | null
  jobStatus: CrawlJobStatus
}

export type CrawlLinkEdge = {
  sourceUrl: string
  targetUrl: string
  hrefRaw: string
  anchorText: string
  isNofollow: boolean
  targetHttpStatus: number | null
  targetFinalUrl: string | null
  isRedirect: boolean
}

export type LinkMapNodeKind = 'ok' | 'orphan' | 'deep' | 'broken' | 'redirect'

export type LinkMapNode = {
  url: string
  path: string
  title?: string | null
  inlinks: number
  outlinks: number
  depth: number | null
  status: number | null
  crawlStatus: CrawlJobStatus
  kind: LinkMapNodeKind
  parentUrl: string | null
}

export type LinkMapEdge = {
  source: string
  target: string
  anchor: string
  nofollow: boolean
  broken: boolean
  redirect: boolean
}

export type LinkMapMetrics = {
  nodeCount: number
  edgeCount: number
  orphanCount: number
  deepCount: number
  brokenCount: number
  redirectCount: number
  averageDepth: number | null
}

export type InternalLinkMap = {
  homepageUrl: string
  nodes: LinkMapNode[]
  edges: LinkMapEdge[]
  visualEdges: LinkMapEdge[]
  metrics: LinkMapMetrics
}

export type LinkSourceSuggestion = {
  sourceUrl: string
  targetUrl: string
  anchorText: string
  reason: string
  insertion: 'related-list' | 'nav'
}

export type Page2LinkCache = {
  anchorText: string
  sources: Array<{ sourceUrl: string; insertion: 'related-list' }>
}

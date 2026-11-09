import type {
  LinkMapEdge,
  LinkMapMetrics,
  LinkMapNode,
  LinkSourceSuggestion,
} from './types'

export type LinkMapCrawlStatus = {
  runId: string
  status: string
  isPartial: boolean
  urlsFound: number
  urlsDiscovered: number
  urlsCrawled: number
  urlsFailed: number
  urlCap: number | null
  chunkSize: number
  updatedAt: string | null
  startedAt: string | null
  finishedAt: string | null
  errorDetail: string | null
}

export type LinkMapDetail = {
  node: LinkMapNode | null
  inlinks: LinkMapEdge[]
  outlinks: LinkMapEdge[]
  suggestions: LinkSourceSuggestion[]
  orphanFindingId: string | null
  canCreateRelatedFinding: boolean
}

export type LinkMapResponse = {
  origin: string
  siteId: string | null
  crawl: LinkMapCrawlStatus | null
  graph: {
    homepageUrl: string
    nodes: LinkMapNode[]
    edges: LinkMapEdge[]
    metrics: LinkMapMetrics
  } | null
  detail: LinkMapDetail | null
  error?: string
}

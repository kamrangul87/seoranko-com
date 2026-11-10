import type {
  LinkMapEdge,
  LinkMapMetrics,
  LinkMapNode,
  LinkSourceSuggestion,
} from './types'
import type { PlannedLink, TopicCluster } from './plan-links'

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

export type LinkPlanResponse = {
  origin: string
  siteId: string
  runId: string
  requiresApproval: boolean
  clusters: TopicCluster[]
  links: PlannedLink[]
  graph: LinkMapResponse['graph']
  error?: string
}

export type LinkMapApprovalItem = {
  id: string
  pageUrl: string | null
  detail: string
  status: 'pending' | 'approved' | 'pr_opened' | 'merged' | 'rejected'
  prUrl: string | null
  prNumber: number | null
  targets: Array<{
    href: string
    anchorText: string
    score?: number
    reason?: string
    weakMatch?: boolean
  }>
  score: number | null
  reason: string | null
  weakMatch: boolean
  verifyBadge: 'verified' | 'problem' | null
  neverAutoMerge: true
  canRegenerate: boolean
}

export type LinkHealthIssueItem = {
  id: string
  kind: string
  sourceUrl: string
  targetUrl: string | null
  href: string | null
  anchorText: string
  hint: string
  mechanical: boolean
  neverAutoMerge: true
}

export type LinkHealthResponse = {
  siteId: string
  runId: string | null
  issues: LinkHealthIssueItem[]
  queued?: number
  merged: false
  error?: string
}

export type LinkMapApprovalsResponse = {
  siteId: string
  items: LinkMapApprovalItem[]
  merged: false
  error?: string
}

export type { PlannedLink, TopicCluster }

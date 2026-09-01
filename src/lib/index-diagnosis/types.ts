/** Machine reasons a discovered URL was not fetched/analysed. */
export type CrawlExcludeReason =
  | 'ROBOTS_DISALLOWED'
  | 'META_NOINDEX'
  | 'X_ROBOTS_NOINDEX'
  | 'NON_200'
  | 'DEPTH_LIMIT'
  | 'TIMEOUT'
  | 'PLAN_LIMIT'
  | 'REDIRECT_CHAIN'
  | 'NOT_REACHED'

export type CrawlTerminationReason =
  | 'QUEUE_EMPTY'
  | 'PLAN_LIMIT_REACHED'
  | 'DISCOVERY_CAP_REACHED'
  | 'FETCH_BUDGET_EXHAUSTED'

export type UrlDiscoverySource = 'sitemap' | 'links' | 'both' | 'seed'

export interface DiscoveredUrlRecord {
  url: string
  sources: UrlDiscoverySource[]
  depth: number | null
}

export interface ExcludedUrlRecord {
  url: string
  reason: CrawlExcludeReason
  evidence: string
  /** Set for NON_200 exclusions — literal HTTP status from fetch attempt. */
  httpStatus?: number
}

export interface CrawlCoverage {
  domain: string
  seedUrl: string
  discoveredCount: number
  fetchedCount: number
  excluded: ExcludedUrlRecord[]
  excludedByReason: Record<CrawlExcludeReason, number>
  terminationReason: CrawlTerminationReason
  terminationEvidence: string
  discoverySources: {
    sitemap: number
    links: number
    both: number
    seed: number
  }
  sitemapOnlyUrls: string[]
  linkedOnlyUrls: string[]
  robotsTxtFetched: boolean
  robotsTxtEvidence: string
}

export type IndexabilityVerdict = 'INDEXABLE' | 'BLOCKED' | 'AT_RISK'

export type CanonicalKind = 'self' | 'other' | 'cross-domain' | 'conflicting' | 'missing'

export interface IndexabilityStep {
  step:
    | 'http_status'
    | 'robots_txt'
    | 'meta_robots'
    | 'x_robots'
    | 'canonical'
    | 'crawl_depth'
    | 'internal_links_in'
    | 'duplicate_cluster'
  passed: boolean
  evidence: string
}

export interface InboundLinkEvidence {
  fromUrl: string
  fromDepth: number
}

export interface PageIndexability {
  url: string
  verdict: IndexabilityVerdict
  decisiveStep: IndexabilityStep['step'] | null
  decisiveEvidence: string
  steps: IndexabilityStep[]
  httpStatus: number
  crawlDepth: number
  internalLinksIn: number
  inboundLinks: InboundLinkEvidence[]
  duplicateClusterId: string | null
  duplicateClusterSize: number
  mainContentFingerprint: string
  pathPattern: string
  depthBand: string
}

export interface CohortMetrics {
  cohortId: string
  label: string
  kind: 'path_pattern' | 'depth_band' | 'duplicate_cluster'
  size: number
  medianInternalLinksIn: number
  medianDepth: number
  duplicateClusterDensity: number
  atRiskShare: number
  flagged: boolean
  flagReason: string | null
  flagEvidence: string | null
}

export interface IndexDiagnosisCause {
  cause: string
  affectedUrlCount: number
  exampleUrl: string
  exampleEvidence: string
}

export type SiteFollowUpTaskKind =
  | 'canonical'
  | 'sitemap_gap'
  | 'non_200'
  | 'duplicate_cohort'

export type ManualFixSnippetKind =
  | 'html'
  | 'redirect-nextjs'
  | 'redirect-htaccess'
  | 'redirect-nginx'
  | 'sitemap-xml'
  | 'guidance'

export interface ManualFixSnippet {
  id: string
  label: string
  kind: ManualFixSnippetKind
  content: string
}

export interface DuplicateCohortBriefContext {
  cohortLabel: string
  cohortId: string
  flagEvidence: string
  exampleUrls: string[]
  duplicateDensity?: number
}

export interface ManualFixPayload {
  taskId: string
  fixType: SiteFollowUpTaskKind
  evidenceCitation: string
  snippets: ManualFixSnippet[]
  /** Guidance when fix is "remove dead link" vs redirect. */
  removeLinkGuidance?: string
  /** Near-duplicate cohort — route to Content Brief instead of code snippets. */
  briefSeedKeyword?: string
  briefContext?: DuplicateCohortBriefContext
}

export interface SiteFollowUpTask {
  id: string
  kind?: SiteFollowUpTaskKind
  title: string
  detail: string
  evidence: string
  affectedUrls: string[]
}

export interface IndexDiagnosisVerdict {
  headline: string
  topCauses: IndexDiagnosisCause[]
  indexableCount: number
  blockedCount: number
  atRiskCount: number
}

export interface IndexDiagnosisResult {
  coverage: CrawlCoverage
  pages: PageIndexability[]
  cohorts: CohortMetrics[]
  verdict: IndexDiagnosisVerdict
  followUpTasks: SiteFollowUpTask[]
  /** Deterministic copy-paste snippets keyed by follow-up task id. */
  manualFixesByTaskId?: Record<string, ManualFixPayload>
  /** Reverse lookup of internal links to each URL (from fetched pages). */
  inboundLinksByUrl?: Record<string, InboundLinkEvidence[]>
  ranAt: string
}

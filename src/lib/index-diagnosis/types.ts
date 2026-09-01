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
  /** URLs discovered in live/sitemap.xml during crawl — used for gap cross-checks. */
  sitemapDiscoveredUrls: string[]
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
  /** From crawl HTML — used for cohort topic derivation. */
  pageTitle: string
  pageH1: string
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
  | 'redirect-vercel'
  | 'redirect-htaccess'
  | 'redirect-nginx'
  | 'sitemap-xml'
  | 'guidance'

export interface ManualFixSnippet {
  id: string
  label: string
  kind: ManualFixSnippetKind
  content: string
  /** Plain-language instructions shown above the code block (developer path). */
  placementBefore?: string
  /** Deploy / Fix Agent notes shown below the code block. */
  placementAfter?: string
}

export interface DuplicateCohortBriefContext {
  cohortLabel: string
  cohortId: string
  flagEvidence: string
  exampleUrls: string[]
  duplicateDensity?: number
  /** Real shared subject derived from cohort page titles/slugs — not the path pattern. */
  sharedTopic: string
  suggestedBriefTitle: string
  pageSummaries: Array<{
    url: string
    title: string
    h1: string
    slugLabel: string
  }>
}

export type ManualFixMode = 'content' | 'infrastructure' | 'hybrid'

export interface ManualFixRedirectTarget {
  fromUrl: string
  toUrl: string
  evidence: string
  httpStatus?: number
  inboundFrom?: string[]
}

export interface ManualFixPayload {
  taskId: string
  fixType: SiteFollowUpTaskKind
  fixMode: ManualFixMode
  evidenceCitation: string
  snippets: ManualFixSnippet[]
  removeLinkGuidance?: string
  briefSeedKeyword?: string
  briefContext?: DuplicateCohortBriefContext
  /** Path A — which content fix to apply on pasted HTML. */
  contentFixKind?: 'meta_title' | 'meta_description' | 'missing_h1' | 'canonical_tag' | 'sitemap_entries'
  canonicalSelfUrl?: string
  sitemapEntriesRaw?: string
  /** Path B — redirect pairs for platform step generator. */
  redirectTargets?: ManualFixRedirectTarget[]
  /** Route sitemap_gap fixes to the Sitemap Generator tool. */
  sitemapDomain?: string
  linkedOnlyHighlight?: string[]
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
  /** Crawl HTML keyed by final URL — for sitemap lastmod extraction. */
  htmlByUrl?: Record<string, string>
  /** robots.txt body from crawl — for sitemap checker. */
  robotsTxt?: string
  /** Live vs expected sitemap comparison from last audit crawl. */
  sitemapDrift?: import('@/lib/sitemap-generator/drift').SitemapDriftReport
  /** HTTP-only crawl — JS-rendered links may be false positives. */
  crawlerJsLimitation?: boolean
  ranAt: string
}

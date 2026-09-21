/**
 * Live crawl → detectors → persist for Findings UI.
 *
 * Chunk size rationale (see CRAWL_URL_CHUNK_SIZE): each URL needs a
 * stream-complete fetch + topic-68 confirming re-fetch, then many detectors
 * (including image header probes). Five URLs ≈ safe under a 60s Hobby function
 * with backoff headroom; the run resumes via /tick until the queue empties.
 */

export const CRAWL_URL_CHUNK_SIZE = 5

/** Soft wall-clock budget per tick (ms). Leave headroom under maxDuration=60. */
export const CRAWL_TICK_DEADLINE_MS = 45_000

/** Min delay between SEORANKO requests to a customer origin (ms). */
export const CRAWL_INTER_REQUEST_GAP_MS = 250

/**
 * Max same-host sitemap locs enqueued for one run (product safety cap).
 * Why: startCrawlRun discovers + enqueues in one serverless invocation; an
 * unbounded sitemap can blow memory/time before the first tick. Chunks then
 * process the queue across ticks. Hitting this cap → status partial (frontier
 * not exhausted). Raise only with measured start-handler budgets.
 */
export const CRAWL_MAX_DISCOVERED = 500

export type CrawlRunStatus =
  | 'queued'
  | 'running'
  | 'complete'
  | 'failed'
  | 'partial'

export type CrawlUrlJobStatus =
  | 'queued'
  | 'running'
  | 'crawled'
  | 'failed'
  | 'client_only'
  | 'skipped'

export type CoverageNote = {
  code:
    | 'time_limit'
    | 'client_only'
    | 'fetch_failure'
    | 'crawler_backoff'
    | 'off_host'
    | 'stream_incomplete'
    | 'discovery_cap'
    | 'link_graph_expand'
  detail: string
  url?: string
}

export type PersistedFindingRow = {
  id: string
  siteId: string
  userId: string
  topicId: string
  kind: string
  bucket: 'actionable' | 'informational' | 'internal'
  verdict: string
  severity: string | null
  rollupKey: string
  declarationSite: string | null
  affectedUrlCount: number
  pageUrl: string | null
  detail: string
  autoFixable: boolean
  reportOnly: boolean
  surfaceClass: string
  proposedDiff: Record<string, unknown> | null
  evidenceValues: Record<string, unknown> | null
  sourceRows: unknown[]
  firstSeenRunId: string | null
  lastSeenRunId: string | null
  firstSeenAt: string
  lastSeenAt: string
}

export type PersistedEvidenceRow = {
  id: string
  findingId: string | null
  runId: string
  topicId: string
  verdict: string
  detail: string
  pageUrl: string | null
}

export type CrawlRunRecord = {
  id: string
  siteId: string
  userId: string
  origin: string
  status: CrawlRunStatus
  chunkSize: number
  /** Same-host locs found before any product/test cap. */
  urlsFound: number
  /** Locs actually enqueued (≤ urlsFound; may be capped). */
  urlsDiscovered: number
  urlsCrawled: number
  urlsFailed: number
  urlsClientOnly: number
  urlsSkippedOffHost: number
  /** Cap applied at enqueue time (CRAWL_MAX_DISCOVERED and/or maxUrls). */
  urlCap: number | null
  /** Seed breakdown for discovery reporting. */
  discoverySeeds: {
    fromRobotsSitemaps: number
    fromSitemapFallback: number
    fromHomepage: number
    fromLinkGraph: number
  } | null
  coverageNotes: CoverageNote[]
  isPartial: boolean
  errorDetail: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type CrawlUrlJob = {
  id: string
  runId: string
  url: string
  status: CrawlUrlJobStatus
  httpStatus: number | null
  finalUrl: string | null
  streamComplete: boolean | null
  clientOnly: boolean
  crawlerCausedBackoff: boolean
  errorDetail: string | null
  /** Served HTML snapshot for full-run link graph (topic 43). */
  html: string | null
}

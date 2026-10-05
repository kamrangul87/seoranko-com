/**
 * Live crawl → detectors → persist for Findings UI.
 *
 * Chunk size rationale (see CRAWL_URL_CHUNK_SIZE): each URL needs a
 * stream-complete fetch + topic-68 confirming re-fetch, then many detectors
 * (including image header probes). Five URLs ≈ safe under the soft tick
 * deadline with backoff headroom; the run resumes via /tick until the queue
 * empties. Function maxDuration is 300s (Hobby Fluid ceiling). After the
 * frontier drains, post-crawl phases resume across ticks (never a single-shot
 * whole-site pass that can exceed the invocation budget).
 */

export const CRAWL_URL_CHUNK_SIZE = 5

/**
 * Soft wall-clock budget for URL claiming/processing within a tick (ms).
 * Leave headroom under maxDuration=300 so a drain tick can still enter
 * post-crawl. URL work stops at this soft deadline and resumes;
 * post-crawl phases run on their own ticks after the frontier is empty.
 */
export const CRAWL_TICK_DEADLINE_MS = 45_000

/**
 * Soft wall-clock budget for one post-crawl tick (ms).
 * Under maxDuration=300 with headroom for DB flush + response.
 */
export const CRAWL_POST_CRAWL_DEADLINE_MS = 240_000

/**
 * Topic 26 loc chunk soft floor — process at least this many locs per
 * post-crawl tick when time remains (politeness gap still applies).
 */
export const CRAWL_TOPIC26_LOC_CHUNK = 40

/**
 * A run still queued/running whose `updatedAt` is older than this is treated as
 * abandoned (ticks stopped reaching it) and marked `failed`.
 * Why 30m: well above a healthy multi-tick crawl for small sites; short enough
 * that a tab-close / function-kill cannot leave status=running forever.
 */
export const CRAWL_ABANDONED_MS = 30 * 60 * 1000

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

/**
 * Resumable post-crawl phase ids (ordered).
 * Cursor-chunkable: 22, 24, 25, 28, 26 (by loc), 15, 19, 21, 55–59, 71.
 * Full post-drain snapshot (own tick after graph persisted): 43, 45, 8, 33, 27, 46–48.
 * Rollup/upsert is the last phase — never mark complete with phases outstanding.
 */
export const POST_CRAWL_PHASE_IDS = [
  'persist_inspection',
  'persist_graph',
  'topic_22',
  'topic_24',
  'topic_25',
  'topic_28',
  'topic_26',
  'topic_15',
  'topic_19',
  'topic_21',
  'topic_55_59',
  'topic_71',
  'full_snapshot',
  'rollup',
] as const

export type PostCrawlPhaseId = (typeof POST_CRAWL_PHASE_IDS)[number]

/** Terminal post-crawl marker stored on the run when every phase finished. */
export type PostCrawlPhase = PostCrawlPhaseId | 'done'

export type PostCrawlCursor = {
  /** Topic 26 — next loc index into the flattened urlset loc list. */
  locIndex?: number
  /** Topic 15 — next usableHtml page index. */
  pageIndex?: number
}

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
    | 'plan_page_limit'
    | 'link_graph_expand'
    | 'render_needed'
    | 'render_failed'
    | 'rendered'
    | 'render_deferred'
  detail: string
  url?: string
}

/**
 * open = currently detected, or never resolved.
 * resolved = absent from a later complete *or* partial run for a URL that
 *   run actually crawled (assessed). Never resolved for URLs a partial crawl
 *   never reached — absence proves nothing without a re-assessment.
 * regressed = a resolved finding reappeared. Stays regressed on repeat
 *   re-observation; only a later resolution (going absent again) can move
 *   it back to resolved.
 */
export type FindingStatus = 'open' | 'resolved' | 'regressed'

/**
 * Change Monitoring 3.2 — post-SEORANKO-fix state on the same finding row.
 * Null when the finding never had a SEORANKO fix (crawl-only resolution).
 */
export type PostFixStatus = 'verified' | 'verify_failed' | 'regressed'

export type PersistedFindingRow = {
  id: string
  siteId: string | null
  /** Set when siteId is null — detection-only public-URL scope. */
  detectOrigin: string | null
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
  status: FindingStatus
  /** Set when status transitions to resolved; preserved across a later regression. */
  resolvedAt: string | null
  /** SEORANKO customer-PR merge time; null when only crawl-resolved. */
  fixedAt: string | null
  /** Production (or preview) verify completion time for a SEORANKO fix. */
  verificationAt: string | null
  /** Post-fix lifecycle on the same row — not a parallel status machine. */
  postFixStatus: PostFixStatus | null
  /** Set on resolved → regressed; preserved across later re-resolve. */
  regressionObservedAt: string | null
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

/** Who/what started the crawl — scheduled = Change Monitoring weekly cron. */
export type CrawlRunTrigger = 'manual' | 'scheduled'

export type CrawlRunRecord = {
  id: string
  siteId: string | null
  /** True when started from a public URL with no connected site. */
  detectOnly: boolean
  detectOrigin: string | null
  userId: string
  origin: string
  /** manual (default) or scheduled weekly recrawl. */
  trigger: CrawlRunTrigger
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
  pagesRendered: number
  pagesRenderFailed: number
  /** Cumulative headless render wall-clock ms for this run. */
  totalRenderTimeMs: number
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
  /**
   * Resumable post-crawl phase. Null while the URL frontier is draining.
   * `done` only after rollup finishes — never mark the run complete earlier.
   */
  postCrawlPhase: PostCrawlPhase | null
  /** Phase-local cursor (topic 26 locIndex, topic 15 pageIndex, …). */
  postCrawlCursor: PostCrawlCursor | null
  /** Persisted inspectSiteSitemaps (JSON). Set once; later ticks read it. */
  sitemapInspection: unknown | null
  /** Persisted buildInternalLinkGraph (JSON). Full post-drain snapshot only. */
  linkGraph: unknown | null
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
  /** HTML snapshot for detectors (rendered when available). */
  html: string | null
  renderMode: 'http' | 'rendered' | 'render_failed' | null
  rawHtmlHash: string | null
  renderedHtmlHash: string | null
  /** Set when status transitions to crawled/failed/client_only. Topic 3's
   * persistent-5xx cross-run comparison needs this real timestamp. */
  processedAt: string | null
}

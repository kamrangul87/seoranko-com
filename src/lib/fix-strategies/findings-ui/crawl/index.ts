export {
  CRAWL_URL_CHUNK_SIZE,
  CRAWL_TICK_DEADLINE_MS,
  CRAWL_POST_CRAWL_DEADLINE_MS,
  CRAWL_ABANDONED_MS,
  CRAWL_INTER_REQUEST_GAP_MS,
  CRAWL_MAX_DISCOVERED,
  POST_CRAWL_PHASE_IDS,
} from './constants'
export type {
  CrawlRunStatus,
  CrawlUrlJobStatus,
  CrawlRunTrigger,
  CoverageNote,
  FindingStatus,
  PostFixStatus,
  PersistedFindingRow,
  PersistedEvidenceRow,
  CrawlRunRecord,
  CrawlUrlJob,
  PostCrawlPhase,
  PostCrawlPhaseId,
  PostCrawlCursor,
} from './constants'

export { discoverSameHostUrls, extractSameHostLinks } from './discover'
export type { DiscoverySeedCounts } from './discover'
export { crawlOneUrl } from './fetch-page'
export type { CrawledPage } from './fetch-page'
export {
  runDetectorsOnPages,
  runWholeSiteDetectorsOnCrawl,
  runTopic43OnCrawl,
  rollupAndClassify,
} from './run-detectors'
export type {
  DetectorEmit,
  RolledPersistCandidate,
  WholeSitePageInput,
} from './run-detectors'
export {
  linkCrossTopicRootCauses,
  arePreferredUrlFormVariants,
  parseCanonicalElsewhereTarget,
} from './link-cross-topic-root-causes'
export type {
  LinkableFinding,
  RelatedFindingEvidence,
} from './link-cross-topic-root-causes'

export {
  createMemoryFindingsStore,
  getFindingsStore,
  setFindingsStore,
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
} from './store'
export type { FindingsStore } from './store'
export {
  createSupabaseFindingsStore,
  supabaseFindingsStoreAvailable,
} from './supabase-store'

export {
  startCrawlRun,
  processCrawlTick,
  runCrawlToCompletion,
  failAbandonedCrawlRuns,
} from './orchestrator'
export type { StartCrawlInput, TickResult } from './orchestrator'
export { normalizeAssessedPageUrl } from './store'

export {
  advancePostCrawlPhases,
  applyPostCrawlTick,
  isPostCrawlComplete,
  nextPostCrawlPhase,
  wholeSitePagesFromJobs,
  collectAllPostCrawlEmits,
} from './post-crawl'

export { normalizePublicOrigin } from './normalize-public-origin'

export { classifyUrlObservationPattern } from './observation-timeline'
export type {
  UrlObservationPattern,
  UrlObservationPoint,
  UrlObservationRecord,
} from './observation-timeline'

export {
  buildRegressionReport,
  lookupOutcomeLedgerPr,
  resolveFixPrReference,
} from './regression-report'
export type { FixPrRef, RegressionReport } from './regression-report'

export {
  utcWeekStartMs,
  decideScheduledRecrawl,
  drainCrawlRunToTerminal,
  runScheduledRecrawlForSite,
  runScheduledRecrawlPass,
} from './scheduled-recrawl'
export { summarizePartialCoverage } from './partial-coverage'
export type {
  PartialCoverageBucket,
  PartialCoverageSummary,
} from './partial-coverage'
export {
  buildWhatChangedDigest,
  pickPreviousTerminalRunId,
} from './what-changed'
export type {
  WhatChangedDigest,
  WhatChangedFindingRef,
} from './what-changed'
export type {
  ScheduledSkipReason,
  ScheduledSiteDecision,
  ScheduledRecrawlSiteResult,
  ScheduledSiteInput,
} from './scheduled-recrawl'

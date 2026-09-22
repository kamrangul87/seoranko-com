export {
  CRAWL_URL_CHUNK_SIZE,
  CRAWL_TICK_DEADLINE_MS,
  CRAWL_INTER_REQUEST_GAP_MS,
  CRAWL_MAX_DISCOVERED,
} from './constants'
export type {
  CrawlRunStatus,
  CrawlUrlJobStatus,
  CoverageNote,
  PersistedFindingRow,
  PersistedEvidenceRow,
  CrawlRunRecord,
  CrawlUrlJob,
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
} from './orchestrator'
export type { StartCrawlInput, TickResult } from './orchestrator'

export { normalizePublicOrigin } from './normalize-public-origin'

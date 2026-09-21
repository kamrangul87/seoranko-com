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

export { discoverSameHostUrls } from './discover'
export { crawlOneUrl } from './fetch-page'
export type { CrawledPage } from './fetch-page'
export {
  runDetectorsOnPages,
  rollupAndClassify,
} from './run-detectors'
export type { DetectorEmit, RolledPersistCandidate } from './run-detectors'

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

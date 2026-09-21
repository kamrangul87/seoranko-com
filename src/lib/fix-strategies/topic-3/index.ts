export {
  detect5xxResponses,
  rejectedRepoFixFor5xx,
  rejectedGscAsCurrentFault,
} from './detect'
export type {
  DetectTopic3Options,
  DetectTopic3Result,
  Topic3Finding,
  Topic3Verdict,
  Topic3Class,
  FetchAttemptRecord,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const

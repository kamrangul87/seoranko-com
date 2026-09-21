export {
  detectIndexableUrlsAbsent,
  isSlashOrCaseMismatch,
} from './detect'
export type {
  DetectTopic27Options,
  DetectTopic27Page,
  DetectTopic27Result,
  Topic27Finding,
  Topic27Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'whole-site' as const

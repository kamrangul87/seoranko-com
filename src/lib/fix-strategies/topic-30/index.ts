export {
  detectTitleMissingOrMalformed,
  rejectedGenerateTitleText,
} from './detect'
export type {
  DetectTopic30Options,
  DetectTopic30Page,
  DetectTopic30Result,
  Topic30Finding,
  Topic30Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const

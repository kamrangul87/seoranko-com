export {
  detectInvalidLanguageRegionCodes,
  rejectedReuseTopic34Bcp47,
  rejectedAutoReplaceEs419,
} from './detect'
export type {
  DetectTopic47Options,
  DetectTopic47Result,
  Topic47Finding,
  Topic47Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const

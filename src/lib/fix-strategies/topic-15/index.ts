export {
  detectCanonicalPointsToNoindexed,
  rejectedAutoRemoveNoindex,
} from './detect'
export type {
  DetectTopic15Options,
  DetectTopic15Result,
  DetectTopic15Target,
  Topic15Finding,
  Topic15Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'whole-site' as const

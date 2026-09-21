export {
  detectMissingReturnLinks,
  rejectedGuessLocaleToCompleteCluster,
  rejectedSiteWideFromOnePair,
} from './detect'
export {
  addReciprocalHreflangAnnotation,
} from './fix-add-reciprocal'
export type { AddHreflangAnnotationOptions } from './fix-add-reciprocal'
export type {
  DetectTopic46Options,
  DetectTopic46Result,
  Topic46Finding,
  Topic46Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'whole-site' as const

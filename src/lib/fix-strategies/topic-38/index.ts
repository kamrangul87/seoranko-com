export {
  detectStructuredDataContradictsVisible,
  normalizeDateForCompare,
  rejectedSpamPolicyAccusation,
  rejectedProseOrSemanticCompare,
} from './detect'
export type {
  DetectTopic38Options,
  DetectTopic38Result,
  Topic38Finding,
  Topic38Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const

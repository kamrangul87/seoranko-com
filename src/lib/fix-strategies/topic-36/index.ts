export {
  detectSchemaUrlsDontResolve,
  rejectedRemoveRequiredUrl,
  rejectedRaiseOnAtId,
} from './detect'
export type {
  DetectTopic36Options,
  DetectTopic36Result,
  Topic36Finding,
  Topic36UrlProbe,
  Topic36Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const

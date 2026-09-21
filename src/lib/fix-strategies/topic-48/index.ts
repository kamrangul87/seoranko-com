export {
  detectAlternateTargetNotIndexable,
  rejectedRaiseOnXDefaultRedirect,
  rejectedPartialLocaleRemoval,
  absolutizeAlternateHref,
  assertAtomicLocaleRemoval,
} from './detect'
export type {
  DetectTopic48Options,
  DetectTopic48Result,
  Topic48Finding,
  Topic48Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const

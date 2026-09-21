export {
  detectMetaHeaderDisagree,
  classifyMetaHeaderDisagree,
} from './detect'
export type {
  DetectTopic20Options,
  DetectTopic20Page,
  DetectTopic20Result,
  Topic20Finding,
  Topic20Severity,
  Topic20Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const

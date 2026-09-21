export { detectTagsOutsideHead } from './detect'
export type {
  DetectTopic29Options,
  DetectTopic29Result,
  Topic29Finding,
  Topic29Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const

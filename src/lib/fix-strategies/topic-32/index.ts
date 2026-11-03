export { detectClientRenderedThinOrMissingHeadings } from './detect'
export type {
  DetectTopic32Result,
  Topic32Finding,
  Topic32Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const


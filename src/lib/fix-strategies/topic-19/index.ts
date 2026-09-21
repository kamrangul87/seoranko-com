export { detectNoindexShouldIndex } from './detect'
export type {
  DetectTopic19Page,
  DetectTopic19Result,
  Topic19Finding,
  Topic19Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'whole-site' as const

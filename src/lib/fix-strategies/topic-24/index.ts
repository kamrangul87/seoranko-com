export {
  detectSitemapMissingOrUnreachable,
  rejectedGenerateSitemap,
} from './detect'
export type {
  DetectTopic24Options,
  DetectTopic24Result,
  Topic24Finding,
  Topic24Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'whole-site' as const

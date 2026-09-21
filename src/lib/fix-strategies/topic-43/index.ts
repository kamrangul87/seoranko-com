export {
  detectOrphanPages,
  rejectedUndiscoverabilityClaim,
  rejectedSitemapAsOrphanFix,
  isHomepageUrl,
} from './detect'
export type {
  DetectTopic43Options,
  DetectTopic43Result,
  Topic43Finding,
  Topic43Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'whole-site' as const

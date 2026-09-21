export {
  detectSitemapNotReferencedInRobots,
  proposeAddSitemapRecord,
  applyAddSitemapRecord,
  rejectedCreateRobotsTxtForSitemap,
} from './detect'
export type {
  DetectTopic28Options,
  DetectTopic28Result,
  Topic28Finding,
  Topic28Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'whole-site' as const

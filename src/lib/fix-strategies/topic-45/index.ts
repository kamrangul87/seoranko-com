export {
  detectCrawlDepth,
  rejectedGoogleDepthThreshold,
  rejectedDepthPreventsIndexing,
} from './detect'
export type {
  DetectTopic45Options,
  DetectTopic45Result,
  Topic45Finding,
  Topic45Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'whole-site' as const

export {
  detectDuplicateTitlesDescriptions,
  groupIsUrlVariantCluster,
  groupIsCanonicalCluster,
  rejectedGenerateDistinctTitles,
} from './detect'
export type {
  DetectTopic33Options,
  DetectTopic33Page,
  DetectTopic33Result,
  Topic33Finding,
  Topic33Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'whole-site' as const

export {
  detectPotentialSoft404,
  structuralBodyTextLength,
  rejectedTextMatchErrorPhrases,
  rejectedClaimSoft404Classifier,
} from './detect'
export type {
  DetectTopic2bOptions,
  DetectTopic2bResult,
  Topic2bFinding,
  Topic2bVerdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const

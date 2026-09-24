export {
  detectLangDeclaration,
  crossHostRedirectLocation,
  suppressArticleMissingInLanguage,
  rejectedDefaultLangEn,
} from './detect'
export type {
  DetectTopic34Options,
  DetectTopic34Result,
  Topic34Finding,
  Topic34Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const

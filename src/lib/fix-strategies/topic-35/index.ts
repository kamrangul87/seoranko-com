export {
  detectRequiredPropertiesAbsent,
  authorNameNeedsCleanup,
  looksMergedAuthors,
  cleanAuthorName,
  splitMergedAuthors,
  ARTICLE_IMAGE_MIN_PIXELS,
} from './detect'
export type {
  DetectTopic35Options,
  DetectTopic35Result,
  Topic35Finding,
  Topic35Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const

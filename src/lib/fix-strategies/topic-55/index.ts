export {
  detectGoogleChosenCanonicalMismatch,
} from './detect'
export type {
  DetectTopic55Options,
  DetectTopic55Result,
  Topic55Finding,
  Topic55Verdict,
} from './detect'

/** Whole-site: needs GSC inspection set + optional crawl declarations. */
export const DETECTOR_SCOPE = 'whole-site' as const

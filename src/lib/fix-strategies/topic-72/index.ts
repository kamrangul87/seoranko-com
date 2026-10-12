export {
  detectPrivacyConsentIssues,
  privacyConsentPostconditionMet,
} from './detect'
export type {
  DetectTopic72Options,
  DetectTopic72Result,
  Topic72Finding,
  Topic72Verdict,
} from './detect'

/** Whole-site: needs full crawl set for vendor inventory + privacy page. */
export const DETECTOR_SCOPE = 'whole-site' as const

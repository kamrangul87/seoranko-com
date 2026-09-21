export {
  detectDeprecatedTypes,
  pageHasVisibleFaq,
  faqSchemaTextPresentInBody,
  removeDeprecatedTypeFromJsonLd,
  rejectedAutoRemoveDeprecated,
  STRUCTURED_DATA_DEPRECATION_TABLE,
} from './detect'
export type {
  DetectTopic39Options,
  DetectTopic39Result,
  Topic39Finding,
  Topic39Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const

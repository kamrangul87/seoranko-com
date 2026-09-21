export { detectBlockedRenderResources } from './detect'
export type {
  DetectTopic21Page,
  DetectTopic21Result,
  Topic21Finding,
  Topic21Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'whole-site' as const

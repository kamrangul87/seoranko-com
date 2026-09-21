export {
  detectSitemapXmlInvalid,
  applyTopic25AutoFixes,
  rejectedRewriteLastmod,
} from './detect'
export type {
  DetectTopic25Options,
  DetectTopic25Result,
  Topic25Finding,
  Topic25Verdict,
} from './detect'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'whole-site' as const

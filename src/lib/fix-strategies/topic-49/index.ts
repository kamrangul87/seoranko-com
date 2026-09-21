export { detectImgMissingDimensions } from './detect'
export type {
  DetectTopic49Options,
  DetectTopic49Result,
  Topic49Finding,
} from './detect'

export {
  classifyImgDimensions,
  parseDeclaredDims,
  parseSrcsetUrls,
  ratiosMatch,
  ratioTolerance,
} from './classify'
export type {
  ClassifyImgResult,
  ImgDimSeverity,
  Topic49Verdict,
} from './classify'

export { inspectImgCss } from './css-signals'
export { setImgDimensions } from './fix-set-dimensions'
export { verifyLiveImgDimensions } from './verify-live-dimensions'
export type { LiveImgDimVerification } from './verify-live-dimensions'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const

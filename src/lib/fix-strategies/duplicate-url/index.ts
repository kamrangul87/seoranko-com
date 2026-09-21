export { detectDuplicateUrls } from './detect'
export type {
  DetectDuplicateUrlOptions,
  DetectDuplicateUrlPage,
  DetectDuplicateUrlResult,
  DuplicateUrlFinding,
  VariantDiscoverability,
} from './detect'

export {
  classifyDuplicateUrl,
  allParamsAreTracking,
  hasAuthOrSignedParam,
} from './classify'
export type {
  ClassifyDuplicateInput,
  ClassifyDuplicateResult,
  DuplicateUrlVerdict,
} from './classify'

export {
  setTrailingSlashConfig,
  setCanonicalToCleanUrl,
  rejectedRobotsTxtParamBlock,
} from './fix-normalize'

export { verifyLiveDuplicateNormalized } from './verify-live'
export type { LiveDuplicateUrlVerification } from './verify-live'

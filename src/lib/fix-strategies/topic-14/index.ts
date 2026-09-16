export { detectCanonicalTargetNot200, selfCanonicalUrl } from './detect'
export type {
  DetectTopic14Options,
  DetectTopic14Page,
  DetectTopic14Result,
  Topic14Finding,
} from './detect'

export { classifyCanonicalTarget } from './classify'
export type {
  ClassifyTopic14Input,
  ClassifyTopic14Result,
  Topic14Verdict,
} from './classify'

export { setHeadCanonicalHref } from './fix-repoint-canonical'
export { verifyLiveCanonicalTarget200 } from './verify-live-target'
export type { LiveCanonicalTargetVerification } from './verify-live-target'

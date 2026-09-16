export { detectCanonicalAbsent } from './detect'
export type {
  DetectTopic13Options,
  DetectTopic13Page,
  DetectTopic13Result,
  Topic13Finding,
} from './detect'

export { classifyCanonicalAbsent } from './classify'
export type {
  ClassifyTopic13Input,
  ClassifyTopic13Result,
  Topic13Severity,
  Topic13Verdict,
} from './classify'

export { addHeadCanonical, removeBodyCanonicals } from './fix-add-canonical'
export { verifyLiveCanonicalPresent } from './verify-live-canonical'
export type { LiveCanonicalAbsentVerification } from './verify-live-canonical'

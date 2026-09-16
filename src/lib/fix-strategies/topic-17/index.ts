export { detectMultipleCanonicals } from './detect'
export type {
  DetectTopic17Page,
  DetectTopic17Result,
  Topic17Finding,
} from './detect'

export { classifyMultipleCanonicals } from './classify'
export type {
  ClassifyTopic17Input,
  ClassifyTopic17Result,
  Topic17Verdict,
} from './classify'

export {
  collapseToSingleHeadCanonical,
  removeBodyCanonicalLinks,
} from './fix-collapse-canonicals'
export { verifyLiveSingleHeadCanonical } from './verify-live-single'
export type { LiveMultipleCanonicalVerification } from './verify-live-single'

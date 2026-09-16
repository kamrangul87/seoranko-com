export { detectHtmlHeaderCanonicalDisagree } from './detect'
export type {
  DetectTopic16Options,
  DetectTopic16Page,
  DetectTopic16Result,
  Topic16Finding,
} from './detect'

export { classifyHtmlHeaderCanonicalDisagree } from './classify'
export type {
  ClassifyTopic16Input,
  ClassifyTopic16Result,
  Topic16Verdict,
} from './classify'

export { stripLinkCanonicalFromHeaderValue } from './fix-remove-header-canonical'
export { verifyLiveSingleCanonicalDeclaration } from './verify-live-agree'
export type { LiveHtmlHeaderAgreeVerification } from './verify-live-agree'

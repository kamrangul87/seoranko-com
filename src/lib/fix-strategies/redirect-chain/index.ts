export { walkRedirectChain } from './walk'
export type { ChainWalkResult } from './walk'

export { detectRedirectTopics } from './detect'
export type {
  DetectRedirectTopicsOptions,
  DetectRedirectTopicsPage,
  DetectRedirectTopicsResult,
  RedirectTopicsFinding,
} from './detect'

export {
  classifyRedirectChain,
  severityForChainHops,
} from './classify-topic-4'
export type {
  ClassifyTopic4Input,
  ClassifyTopic4Result,
  Topic4Severity,
  Topic4Verdict,
} from './classify-topic-4'

export {
  classifyRedirectLoop,
  isTrailingSlashBounceOnly,
} from './classify-topic-5'
export type {
  ClassifyTopic5Input,
  ClassifyTopic5Result,
  Topic5Verdict,
} from './classify-topic-5'

export { classifyTemporaryWherePermanent } from './classify-topic-6'
export type {
  ClassifyTopic6Input,
  ClassifyTopic6Result,
  PermanenceEvidence,
  Topic6Verdict,
} from './classify-topic-6'

export {
  classifyRedirectTargetNot200,
  rejectedHomepageRepoint,
} from './classify-topic-7'
export type {
  ClassifyTopic7Input,
  ClassifyTopic7Result,
  TerminalClassification,
  Topic7Verdict,
} from './classify-topic-7'

export {
  collapseRedirectInConfig,
  proposePermanentStatusInConfig,
  removeRedirectFromConfig,
} from './fix-redirects'

export {
  verifyLiveChainCollapsed,
  verifyLiveOriginResolvesCleanly,
  verifyLivePermanentRedirect,
} from './verify-live'
export type { LiveRedirectVerification } from './verify-live'

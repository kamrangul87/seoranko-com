/**
 * Client-safe findings-ui exports (no Node fs).
 */
export type {
  FindingBucket,
  FindingSurfaceClass,
  ProposedDiff,
  SourceCitation,
  InternalEvidenceItem,
  LeftAloneItem,
  SourceTier,
  UiFinding,
  FindingsListResponse,
  FixFlowStep,
  FixFlowState,
} from './types'

export {
  classifyVerdictBucket,
  classifySurfaceClass,
  isListVisible,
  canOfferFix,
} from './buckets'

export {
  ownerPlainEnglish,
  whyNotFixed,
  whyNotFixedOrFallback,
  sourceTierForTopic,
  primarySourceIdForTopic,
  sourceTierLabel,
  whyFindingNotAutoFixed,
  OWNER_PLAIN_ENGLISH,
  WHY_NOT_FIXED,
} from './owner-copy'

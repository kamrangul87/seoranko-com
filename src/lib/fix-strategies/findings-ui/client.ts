/**
 * Client-safe findings-ui exports (no Node fs).
 */
export type {
  FindingBucket,
  FindingSurfaceClass,
  ProposedDiff,
  SourceCitation,
  InternalEvidenceItem,
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

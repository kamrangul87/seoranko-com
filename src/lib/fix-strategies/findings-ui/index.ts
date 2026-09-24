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
  SOURCE_TIER_BY_TOPIC,
  PRIMARY_SOURCE_ID_BY_TOPIC,
} from './owner-copy'

export { persistedToUiFinding, aggregateLeftAlone } from './map-persisted'

export { TOPIC_DOSSIER_SLUG, dossierSlugForTopic } from './topic-registry'
export { loadSourceRows, sourcesForDossier } from './sources'
export { buildDemoFindings, DEMO_RUN_META } from './demo-run'
export {
  getFixFlow,
  approveFix,
  commitFix,
  verifyFix,
} from './fix-flow-store'

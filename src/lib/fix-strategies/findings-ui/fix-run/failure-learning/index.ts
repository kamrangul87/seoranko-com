export {
  buildFailureSignature,
  normaliseFailureReason,
  signatureHash,
  type FixFailureStage,
} from './signature'
export {
  buildFailureEvidence,
  evidenceContainsBodyText,
  sanitiseHtmlSnippet,
  type FixFailureEvidence,
} from './evidence'
export {
  recordFixFailure,
  recordFixFailureSafe,
  type RecordFixFailureInput,
  type RecordFixFailureResult,
} from './record'
export {
  BREAKER_CONSECUTIVE,
  BREAKER_DISTINCT_SITES,
  BREAKER_WINDOW_DAYS,
  evaluateAndMaybePause,
  e2ePassedSince,
  fixTypeKey,
  isFixTypePaused,
  listAllFixTypeStatuses,
  listPausedFixTypes,
  loadPausedFixTypeSet,
  resumeFixType,
  shouldPauseFixType,
  type FixTypeStatusRow,
  type ResumeResult,
} from './circuit-breaker'
export {
  buildFixtureCaseFiles,
  openFixtureCasePr,
} from './fixture-draft'
export {
  buildFailureDigestPayload,
  formatFailureDigestText,
  sendFailureDigestEmail,
  shouldSendFailureDigest,
  type FailureDigestPayload,
} from './digest'
export { listFailureSignatures } from './list-signatures'

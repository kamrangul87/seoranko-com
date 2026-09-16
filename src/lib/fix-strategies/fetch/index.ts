export { FETCH_EVIDENCE_CONFIG } from './config'
export type { FetchEvidenceConfig } from './config'
export { parseRetryAfter } from './parse-retry-after'
export { classifyHttpStatus, fetchUrl } from './fetch-url'
export { fetchWithEvidence } from './evidence'
export { readResponseBodyToCompletion } from './read-body'
export { presenceAfterServedHtml } from './content-presence'
export type { ContentPresenceState } from './content-presence'
export { requireCompleteStream, probeContentSignals } from './detector-guard'
export type {
  ContentSignalFinding,
  DetectorFetchGate,
  DetectorRefusal,
} from './detector-guard'
export type {
  EvidenceResult,
  FetchDeps,
  FetchOutcome,
  FetchOutcomeKind,
  HttpStatusClass,
} from './types'

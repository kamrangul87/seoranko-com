export {
  extractAnchors,
  extractInternalFetchableAnchors,
  isInternalHref,
  isSkippableHref,
} from './extract-anchors'
export { detectGoneAnchors, detectBrokenInternalLinks } from './detect'
export type {
  DetectTopic1Result,
  Finding404,
  Finding410,
  FindingIndeterminateNoindex,
  FindingSoft404,
  Topic1Finding,
} from './detect'
export type { Detect410Result, GoneAnchorFinding } from './detect-410'
export { detectGoneAnchorsFromFetch } from './detect-from-fetch'
export type { DetectGoneFromFetchResult } from './detect-from-fetch'
export { removeAnchorByHref } from './fix-remove-anchor'
export { verifyAnchorAbsent } from './verify-anchor-absent'
export { decide404Branch } from './decide-404'
export type { Decision404 } from './decide-404'
export {
  findDeletedRouteEvidence,
  candidatePageRelPaths,
  gitEvidenceUnavailable,
  isShallowClone,
  isPathHistoryReachable,
} from './git-route-history'
export type {
  GitDeletionEvidence,
  GitHistoryStatus,
  GitRunner,
} from './git-route-history'
export {
  scoreSuccessors,
  pathSimilarity,
  contentSimilarity,
  normalizeMainContent,
} from './successor-similarity'
export type { LivePage, SuccessorCandidate } from './successor-similarity'
export { SUCCESSOR_SIMILARITY_CONFIG } from './config'

/** Crawl wiring: 'per-page' = safe in chunk loop; 'whole-site' = post-crawl only. */
export const DETECTOR_SCOPE = 'per-page' as const

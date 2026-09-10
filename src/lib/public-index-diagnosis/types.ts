/**
 * Public Index Diagnosis — machine exclusion reasons (one per URL).
 * Every reason is assigned by deterministic code with stored evidence.
 */

export const PUBLIC_EXCLUSION_REASONS = [
  'INDEXABLE',
  'BLOCKED_BY_ROBOTS',
  'NOINDEX_TAG',
  'NOINDEX_HEADER',
  'CANONICAL_POINTS_ELSEWHERE',
  'REDIRECT_CHAIN',
  'HTTP_4XX',
  'HTTP_5XX',
  'SOFT_404_SUSPECTED',
  'ORPHAN_NO_INLINKS',
  'DEPTH_EXCEEDS_5',
  'NEAR_DUPLICATE',
  'THIN_CONTENT',
] as const

export type PublicExclusionReason = (typeof PUBLIC_EXCLUSION_REASONS)[number]

export type PublicUrlEvidence = {
  url: string
  reason: PublicExclusionReason
  httpStatus: number | null
  robotsRuleLine: string | null
  metaRobots: string | null
  xRobotsTag: string | null
  canonicalTarget: string | null
  canonicalIsSelf: boolean | null
  crawlDepth: number | null
  internalInlinkCount: number | null
  mainContentWordCount: number | null
  nearDuplicateSimilarity: number | null
  soft404Signals: string[]
  evidenceNotes: string
}

export type PublicCauseSummary = {
  reason: PublicExclusionReason
  affectedUrlCount: number
  exampleUrl: string
  headline: string
  explanation: string
  /** Concrete imperative remediation — one line, no strategy internals. */
  action: string
  /** True when Fix Agent can apply a mechanical strategy for this reason. */
  autoFixable: boolean
}

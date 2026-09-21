/**
 * Findings UI model — normalizes detector buckets for presentation.
 * Detectors are unchanged; this layer only reads their shapes.
 */

export type FindingBucket = 'actionable' | 'informational' | 'internal'

export type FindingSurfaceClass =
  | 'auto-fixable'
  | 'human-review'
  | 'finding'
  | 'informational'
  | 'report-only'
  | 'internal'

export type ProposedDiff = {
  summary: string
  /** Unified-ish preview of the proposed edit when known. */
  before?: string | null
  after?: string | null
  targetPath?: string | null
}

export type SourceCitation = {
  sourceId: number
  url: string | null
  section: string
  requirement: string
  verifiedOn: string
}

export type InternalEvidenceItem = {
  verdict: string
  detail: string
  pageUrl?: string | null
}

/**
 * One user-facing (or internal) finding row after optional rollup.
 */
export type UiFinding = {
  id: string
  topicId: string
  kind: string
  verdict: string
  severity: string | null
  detail: string
  pageUrl: string | null
  /** Rolled-up: component / generator / layout name. */
  declarationSite: string | null
  affectedUrlCount: number
  rolledUp: boolean
  bucket: FindingBucket
  surfaceClass: FindingSurfaceClass
  autoFixable: boolean
  /** True when no mechanical fix exists — list/detail must not offer Fix. */
  reportOnly: boolean
  proposedDiff: ProposedDiff | null
  /** Values shown for human-review contradictions (e.g. entity url vs page). */
  evidenceValues: { left: string; right: string; leftLabel?: string; rightLabel?: string } | null
  sources: SourceCitation[]
  /** Suppress / ok / route rows related to this finding — never in the list. */
  internalEvidence: InternalEvidenceItem[]
  dossierSlug: string | null
}

export type FindingsListResponse = {
  origin: string
  crawledAt: string | null
  demo: boolean
  siteId: string | null
  crawl: {
    runId: string | null
    status: string | null
    isPartial: boolean
    coverageNotes: Array<{ code: string; detail: string; url?: string }>
    urlsDiscovered: number
    urlsCrawled: number
    chunkSize: number
  } | null
  counts: {
    actionable: number
    informational: number
    internal: number
  }
  findings: UiFinding[]
}

export type FixFlowStep = 'idle' | 'approved' | 'committed' | 'verified' | 'failed'

export type FixFlowState = {
  findingId: string
  step: FixFlowStep
  approvedAt: string | null
  committedAt: string | null
  commitStub: boolean
  commitDetail: string | null
  verifiedAt: string | null
  verifyOk: boolean | null
  verifyDetail: string | null
}

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
  /** Plain-English reason this suppress/route/skip/ok was left alone. */
  whyNotFixed?: string | null
}

/** Aggregated “checked and left alone” row for the findings list view. */
export type LeftAloneItem = {
  verdict: string
  whyNotFixed: string
  count: number
  topicIds: string[]
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
  evidenceValues: {
    left?: string
    right?: string
    leftLabel?: string
    rightLabel?: string
    /** Shared root-cause links: symptoms attached to a primary finding. */
    relatedFindings?: Array<{
      topicId: string
      verdict: string
      detail: string
      pageUrl?: string | null
      relationship?: string
      rootCause?: string
    }>
    rootCause?: string
    memberUrls?: string[]
    [key: string]: unknown
  } | null
  sources: SourceCitation[]
  /** Suppress / ok / route rows related to this finding — never in the list. */
  internalEvidence: InternalEvidenceItem[]
  dossierSlug: string | null
  /** Fixed owner-facing sentence for this verdict (not model-generated). */
  ownerPlainEnglish: string | null
  /** Source-rule tier for the topic. */
  sourceTier: SourceTier
  /** Preferred _sources.md row id for this topic. */
  primarySourceId: number | null
  /** Why SEORANKO did not auto-apply this listable finding (null if auto-fixable). */
  whyNotAutoFixed: string | null
  /** open / resolved (absent from a later complete crawl) / regressed (a resolved finding reappeared). */
  status: 'open' | 'resolved' | 'regressed'
  /** Set once status has ever been resolved; preserved across a later regression. */
  resolvedAt: string | null
}

export type SourceTier =
  | 'STANDARD'
  | 'VENDOR-DOCUMENTED'
  | 'SEORANKO PRODUCT DECISION'
  | 'OBSERVED'

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
    /** Same-host locs found before any cap. */
    urlsFound: number
    /** Locs enqueued (≤ urlsFound). */
    urlsDiscovered: number
    urlsCrawled: number
    /** Cap applied at enqueue, if any. */
    urlCap: number | null
    chunkSize: number
    pagesRendered?: number
    pagesRenderFailed?: number
    /** Cumulative headless render wall-clock ms. */
    totalRenderTimeMs?: number
  } | null
  counts: {
    actionable: number
    informational: number
    internal: number
  }
  findings: UiFinding[]
  /**
   * Suppress / route / skip / ok reasons attached to listed findings.
   * Internal-bucket rows stay out of `findings`; this is the audit trail view.
   */
  leftAlone: LeftAloneItem[]
}

export type FixFlowStep = 'idle' | 'approved' | 'committed' | 'verified' | 'failed'

export type FixFlowState = {
  findingId: string
  step: FixFlowStep
  approvedAt: string | null
  committedAt: string | null
  /** Always false for real commits; retained for older rows. */
  commitStub: boolean
  commitDetail: string | null
  commitSha?: string | null
  branchName?: string | null
  prUrl?: string | null
  prNumber?: number | null
  previewUrl?: string | null
  verifiedAt: string | null
  verifyOk: boolean | null
  verifyDetail: string | null
  /** True when product merged under auto_merge_enabled gates. */
  autoMerged?: boolean | null
  mergedAt?: string | null
  mergeSha?: string | null
  productionVerifyOk?: boolean | null
  productionVerifyDetail?: string | null
  revertPrUrl?: string | null
  revertPrNumber?: number | null
  needsHumanAttention?: boolean
  flagDetail?: string | null
  /** Why auto-merge did not run (setting off or a gate failed). */
  autoMergeBlockedReason?: string | null
}

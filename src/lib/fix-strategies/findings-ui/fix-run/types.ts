/**
 * One-run Fix Agent types — one site run = one branch = one PR.
 */

export const RUN_STATUSES = [
  'queued',
  'running',
  'awaiting_approval',
  'merging',
  'complete',
  'failed',
] as const

export type FixRunStatus = (typeof RUN_STATUSES)[number]

export const RUN_PHASES = [
  'create_branch',
  'apply_next',
  'ensure_pr',
  'wait_preview',
  'verify_preview_next',
  'await_approval',
  'merge',
  'verify_production_next',
  'recrawl',
  'done',
] as const

export type FixRunPhase = (typeof RUN_PHASES)[number]

export const RUN_ITEM_STATUSES = [
  'pending',
  'applying',
  'committed',
  'preview_verified',
  'failed',
  'production_verified',
  'verified_live',
  'noop',
] as const

export type FixRunItemStatus = (typeof RUN_ITEM_STATUSES)[number]

export type FixRunItem = {
  id: string
  runId: string
  findingId: string
  position: number
  status: FixRunItemStatus
  commitSha: string | null
  path: string | null
  previewVerifiedAt: string | null
  productionVerifiedAt: string | null
  failureReason: string | null
  createdAt: string
  updatedAt: string
}

export type FixRunSummary = {
  total: number
  committed: number
  previewVerified: number
  verifiedLive: number
  failed: number
  noop: number
}

export type FixRun = {
  id: string
  userId: string
  siteId: string
  status: FixRunStatus
  phase: FixRunPhase
  branchName: string | null
  prNumber: number | null
  prUrl: string | null
  previewUrl: string | null
  mergeSha: string | null
  approvedAt: string | null
  autoMergeAttempted: boolean
  autoMergeBlockedReason: string | null
  itemCursor: number
  errorDetail: string | null
  summary: FixRunSummary | null
  /** Path contents before each item's commit — for partial-failure revert. */
  prevContents: Record<string, string>
  createdAt: string
  updatedAt: string
  items: FixRunItem[]
}

export type FixRunPublicState = FixRun & {
  /** True when UI may show Approve and merge. */
  canApproveMerge: boolean
  /** Human-readable progress line. */
  progressLabel: string
}

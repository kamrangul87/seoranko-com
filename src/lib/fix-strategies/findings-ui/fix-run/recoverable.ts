/**
 * Which failed/stalled Fix PRs should still show the Recover receipts card.
 * Heartbeat rechecks GitHub; this filter hides closed, receipted, and stale rows.
 */

export type RecoverableRunRow = {
  id: string
  prNumber: number | null
  prUrl: string | null
  createdAt: string
  status: string
  phase: string
  errorDetail: string | null
  closedByCustomer?: boolean | null
  mergedByCustomer?: boolean | null
  mergedAt?: string | null
  summary?: { verifiedLive?: number; committed?: number } | null
}

export type RecoverableFilterInput = {
  runs: RecoverableRunRow[]
  /** PR numbers that already have a verified-live receipt. */
  receiptPrNumbers: Iterable<number>
  /** ISO time of the newest receipt for this site, if any. */
  latestReceiptAt?: string | null
}

function needsRecovery(r: RecoverableRunRow): boolean {
  const status = String(r.status || '')
  const phase = String(r.phase || '')
  const mergedFlag = Boolean(r.mergedByCustomer) || Boolean(r.mergedAt)
  const verifiedLive = Number(r.summary?.verifiedLive ?? 0)
  const committed = Number(r.summary?.committed ?? 0)
  const failedNeedsCheck =
    status === 'failed' ||
    (mergedFlag && verifiedLive === 0 && committed > 0)
  const contradictory = status !== 'complete' && phase === 'done'
  return failedNeedsCheck || contradictory
}

/**
 * Hide the recover card when the PR is closed, already receipted, or
 * superseded by a later verified fix (stale watchdog failure).
 */
export function filterRecoverableRuns(
  input: RecoverableFilterInput,
): RecoverableRunRow[] {
  const receipted = new Set(
    Array.from(input.receiptPrNumbers).filter((n) => Number.isFinite(n)),
  )
  const latestReceiptMs = input.latestReceiptAt
    ? Date.parse(input.latestReceiptAt)
    : NaN

  return input.runs.filter((r) => {
    if (r.prNumber == null) return false
    if (r.closedByCustomer) return false
    if (receipted.has(r.prNumber)) return false
    if (Number(r.summary?.verifiedLive ?? 0) > 0) return false
    if (!needsRecovery(r)) return false
    if (Number.isFinite(latestReceiptMs)) {
      const createdMs = Date.parse(r.createdAt)
      if (Number.isFinite(createdMs) && createdMs < latestReceiptMs) {
        return false
      }
    }
    return true
  })
}

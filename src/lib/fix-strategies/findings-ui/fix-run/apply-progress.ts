/**
 * Apply-phase progress — cursor + stall detection (deterministic, no prompts).
 */

import type { FixRun, FixRunItem, FixRunItemStatus } from './types'
import { pickForwardItemStatus } from './store'

export const PROGRESS_STALL_FP_KEY = '__progressStallFingerprint'
export const PROGRESS_STALL_COUNT_KEY = '__progressStallCount'

/**
 * First pending/applying item at or after the persisted cursor.
 * Never returns position < cursor (avoids re-applying when cursor advanced).
 * No fallback to pending[0] — that re-selected item 0 when cursor > 0.
 */
export function selectNextApplyItem(
  items: FixRunItem[],
  cursor: number,
): FixRunItem | undefined {
  const sorted = [...items].sort((a, b) => a.position - b.position)
  return sorted.find(
    (i) =>
      i.position >= cursor &&
      (i.status === 'pending' || i.status === 'applying'),
  )
}

export function applyProgressFingerprint(run: Pick<FixRun, 'phase' | 'itemCursor' | 'items'>): string {
  const itemSig = [...run.items]
    .sort((a, b) => a.position - b.position)
    .map((i) => `${i.position}:${i.status}`)
    .join(',')
  return `${run.phase}|${run.itemCursor}|${itemSig}`
}

/** Merge DB item rows forward so stale ticks cannot regress status. */
export function mergeItemsForward(
  local: FixRunItem[],
  db: FixRunItem[],
): FixRunItem[] {
  const dbById = new Map(db.map((i) => [i.id, i]))
  return local.map((localItem) => {
    const dbItem = dbById.get(localItem.id)
    if (!dbItem) return localItem
    const status = pickForwardItemStatus(dbItem.status, localItem.status)
    return {
      ...localItem,
      status,
      commitSha: localItem.commitSha ?? dbItem.commitSha,
      path: localItem.path ?? dbItem.path,
      previewVerifiedAt:
        localItem.previewVerifiedAt ?? dbItem.previewVerifiedAt,
      productionVerifiedAt:
        localItem.productionVerifiedAt ?? dbItem.productionVerifiedAt,
      failureReason:
        status === 'failed'
          ? localItem.failureReason ?? dbItem.failureReason
          : status === dbItem.status
            ? dbItem.failureReason ?? localItem.failureReason
            : localItem.failureReason,
      updatedAt: dbItem.updatedAt,
    }
  })
}

export type StallCheckResult =
  | { stalled: false; stallCount: number }
  | { stalled: true; stallCount: number; reason: string }

/**
 * Call at end of a tick when start/end fingerprints match (no progress).
 */
export function recordNoProgressTick(
  prevContents: Record<string, string>,
  fingerprint: string,
): StallCheckResult {
  const prevFp = prevContents[PROGRESS_STALL_FP_KEY] || ''
  const prevCount = Number(prevContents[PROGRESS_STALL_COUNT_KEY] || 0)
  if (fingerprint === prevFp) {
    const stallCount = prevCount + 1
    prevContents[PROGRESS_STALL_FP_KEY] = fingerprint
    prevContents[PROGRESS_STALL_COUNT_KEY] = String(stallCount)
    if (stallCount >= 3) {
      return {
        stalled: true,
        stallCount,
        reason: `Fix run made no progress for ${stallCount} ticks (${fingerprint})`,
      }
    }
    return { stalled: false, stallCount }
  }
  prevContents[PROGRESS_STALL_FP_KEY] = fingerprint
  prevContents[PROGRESS_STALL_COUNT_KEY] = '1'
  return { stalled: false, stallCount: 1 }
}

export function clearProgressStall(prevContents: Record<string, string>): void {
  delete prevContents[PROGRESS_STALL_FP_KEY]
  delete prevContents[PROGRESS_STALL_COUNT_KEY]
}

export function bumpItemCursorAfterApply(
  cursor: number,
  item: FixRunItem,
  terminalStatus: FixRunItemStatus,
): number {
  if (
    terminalStatus === 'committed' ||
    terminalStatus === 'noop' ||
    terminalStatus === 'failed'
  ) {
    return Math.max(cursor, item.position + 1)
  }
  return cursor
}

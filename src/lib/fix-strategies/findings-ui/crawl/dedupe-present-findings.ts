/**
 * One real SEO problem = exactly one currently-present finding row.
 * Re-detection of a regressed issue must update that row; never leave
 * open + regressed (or two opens) for the same topic+verdict+page.
 */

import { isCurrentlyPresentFindingStatus } from '@/lib/fix-strategies/findings-ui/finding-status'

export type DedupePresentFindingRow = {
  id: string
  topicId: string
  verdict: string
  pageUrl: string | null
  status: string
  firstSeenAt: string
  rollupKey: string
}

/** Logical identity shared by duplicate present rows for the same issue. */
export function logicalPresentFindingKey(row: {
  topicId: string
  verdict: string
  pageUrl: string | null
}): string {
  const page = (row.pageUrl ?? '').replace(/\/$/, '').toLowerCase()
  return `${row.topicId}::${row.verdict}::${page}`
}

/**
 * Prefer the earliest-seen row (stable id across regressions). Tie-break by
 * id so the choice is deterministic.
 */
function preferKeeper(a: DedupePresentFindingRow, b: DedupePresentFindingRow): DedupePresentFindingRow {
  if (a.firstSeenAt !== b.firstSeenAt) {
    return a.firstSeenAt < b.firstSeenAt ? a : b
  }
  return a.id < b.id ? a : b
}

/**
 * Among currently-present findings, return ids that should be marked
 * `superseded` so each topic+verdict+page keeps exactly one row.
 */
export function idsToSupersedeAsPresentDuplicates(
  rows: DedupePresentFindingRow[],
): string[] {
  const byKey = new Map<string, DedupePresentFindingRow[]>()
  for (const row of rows) {
    if (!isCurrentlyPresentFindingStatus(row.status)) continue
    const key = logicalPresentFindingKey(row)
    const list = byKey.get(key) ?? []
    list.push(row)
    byKey.set(key, list)
  }
  const supersede: string[] = []
  for (const group of byKey.values()) {
    if (group.length < 2) continue
    const keeper = group.reduce(preferKeeper)
    for (const row of group) {
      if (row.id !== keeper.id) supersede.push(row.id)
    }
  }
  return supersede.sort()
}

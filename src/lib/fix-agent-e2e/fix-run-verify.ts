/**
 * approve_merge_verify helpers — compare against the fix run's own items,
 * never against expected.json counts (those can drift when seed/resolve lag).
 */

export type FixRunItemVerifyInput = {
  status: string
  failureReason?: string | null
  findingId?: string | null
  topicId?: string | null
  verdict?: string | null
  pageUrl?: string | null
}

export type FixRunVerifyResult =
  | { ok: true; liveCount: number; total: number }
  | { ok: false; detail: string; liveCount: number; total: number }

function describeItem(item: FixRunItemVerifyInput): string {
  const who =
    [item.topicId, item.verdict].filter(Boolean).join('/') ||
    item.findingId ||
    'item'
  const where = item.pageUrl ? ` @ ${item.pageUrl}` : ''
  const why =
    item.failureReason?.trim() ||
    (item.status !== 'verified_live' ? `status=${item.status}` : '')
  return why ? `${who}${where}: ${why}` : `${who}${where}`
}

/**
 * Every item on the fix run must be verified_live. List every non-live item
 * (not only status=failed) so empty "Failed:" never hides a count mismatch.
 */
export function assertAllFixRunItemsVerifiedLive(
  items: FixRunItemVerifyInput[],
): FixRunVerifyResult {
  const total = items.length
  const live = items.filter((i) => i.status === 'verified_live')
  const notLive = items.filter((i) => i.status !== 'verified_live')
  if (notLive.length === 0) {
    return { ok: true, liveCount: live.length, total }
  }
  const listed = notLive.map(describeItem).join('; ')
  return {
    ok: false,
    liveCount: live.length,
    total,
    detail: `Only ${live.length}/${total} verified live. Not live: ${listed || '(none listed)'}`,
  }
}

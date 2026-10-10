import { describe, expect, it } from 'vitest'
import {
  applyProgressFingerprint,
  recordNoProgressTick,
  selectNextApplyItem,
} from './apply-progress'
import type { FixRunItem } from './types'

function item(position: number, status: FixRunItem['status']): FixRunItem {
  const now = new Date().toISOString()
  return {
    id: `i-${position}`,
    runId: 'r1',
    findingId: `f-${position}`,
    position,
    status,
    commitSha: null,
    path: null,
    previewVerifiedAt: null,
    productionVerifiedAt: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  }
}

describe('selectNextApplyItem', () => {
  it('skips committed items and respects cursor', () => {
    const items = [
      item(0, 'committed'),
      item(1, 'pending'),
      item(2, 'pending'),
    ]
    expect(selectNextApplyItem(items, 0)?.position).toBe(1)
    expect(selectNextApplyItem(items, 2)?.position).toBe(2)
  })

  it('never re-selects position 0 when cursor is 1 even if item 0 is pending', () => {
    const items = [
      item(0, 'pending'),
      item(1, 'pending'),
      item(2, 'pending'),
    ]
    expect(selectNextApplyItem(items, 1)?.position).toBe(1)
    expect(selectNextApplyItem(items, 1)?.position).not.toBe(0)
  })

  it('returns undefined when no pending items remain at or after cursor', () => {
    const items = [item(0, 'pending'), item(1, 'committed')]
    expect(selectNextApplyItem(items, 2)).toBeUndefined()
  })
})

describe('recordNoProgressTick', () => {
  it('fails after 3 identical fingerprints', () => {
    const prev: Record<string, string> = {}
    const fp = 'apply_next|0|0:committed,1:pending'
    expect(recordNoProgressTick(prev, fp).stalled).toBe(false)
    expect(recordNoProgressTick(prev, fp).stalled).toBe(false)
    const third = recordNoProgressTick(prev, fp)
    expect(third.stalled).toBe(true)
    if (third.stalled) {
      expect(third.reason).toContain('no progress')
    }
  })

  it('resets when fingerprint changes', () => {
    const prev: Record<string, string> = {}
    recordNoProgressTick(prev, 'a')
    recordNoProgressTick(prev, 'a')
    const reset = recordNoProgressTick(prev, 'b')
    expect(reset.stalled).toBe(false)
    expect(reset.stallCount).toBe(1)
  })
})

describe('applyProgressFingerprint', () => {
  it('includes phase cursor and item statuses', () => {
    const fp = applyProgressFingerprint({
      phase: 'apply_next',
      itemCursor: 1,
      items: [item(0, 'committed'), item(1, 'pending')],
    })
    expect(fp).toBe('apply_next|1|0:committed,1:pending')
  })
})

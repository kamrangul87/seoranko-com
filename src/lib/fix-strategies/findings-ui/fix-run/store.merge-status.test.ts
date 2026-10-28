import { describe, it, expect } from 'vitest'
import type { FixRun } from './types'
import { mergeRunForSave } from './store'

function makeRun(overrides: Partial<FixRun> = {}): FixRun {
  return {
    id: 'r1',
    userId: 'u1',
    siteId: 's1',
    status: 'running',
    phase: 'verify_production_next',
    branchName: 'b',
    prNumber: 1,
    prUrl: 'https://github.com/o/r/pull/1',
    previewUrl: null,
    mergeSha: 'abc123',
    mergedByCustomer: true,
    closedByCustomer: false,
    mergedAt: new Date().toISOString(),
    approvedAt: null,
    autoMergeAttempted: false,
    autoMergeBlockedReason: null,
    itemCursor: 0,
    errorDetail: null,
    summary: { total: 0, committed: 0, previewVerified: 0, verifiedLive: 0, failed: 0, noop: 0 },
    prevContents: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [],
    ...overrides,
  }
}

describe('mergeRunForSave status recovery', () => {
  it('allows overriding db failed → running when merged_by_customer and not done', () => {
    const incoming = makeRun({ status: 'running', phase: 'verify_production_next', mergedByCustomer: true })
    const fresh = { status: 'failed', phase: 'done', preview_url: null, item_cursor: 0 }
    const merged = mergeRunForSave(incoming, fresh as unknown as Record<string, unknown>)
    expect(merged.status).toBe('running')
  })

  it('keeps db failed when incoming is also failed', () => {
    const incoming = makeRun({ status: 'failed', phase: 'done' })
    const fresh = { status: 'failed', phase: 'done', preview_url: null, item_cursor: 0 }
    const merged = mergeRunForSave(incoming, fresh as unknown as Record<string, unknown>)
    expect(merged.status).toBe('failed')
  })

  it('keeps db complete unless recovering failed explicitly', () => {
    const incoming = makeRun({ status: 'running', phase: 'verify_production_next' })
    const fresh = { status: 'complete', phase: 'done', preview_url: null, item_cursor: 0 }
    const merged = mergeRunForSave(incoming, fresh as unknown as Record<string, unknown>)
    expect(merged.status).toBe('complete')
  })
})


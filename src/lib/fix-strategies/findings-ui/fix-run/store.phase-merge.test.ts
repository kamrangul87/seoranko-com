import { describe, it, expect } from 'vitest'
import { mergeRunForSave } from './store'
import type { FixRun } from './types'

function run(overrides: Partial<FixRun>): FixRun {
  const now = new Date().toISOString()
  return {
    id: 'r',
    userId: 'u',
    siteId: 's',
    status: 'running',
    phase: 'verify_production_next',
    branchName: 'b',
    prNumber: 1,
    prUrl: 'https://github.com/o/r/pull/1',
    previewUrl: null,
    mergeSha: 'abc',
    mergedByCustomer: true,
    mergedAt: now,
    approvedAt: null,
    autoMergeAttempted: false,
    autoMergeBlockedReason: null,
    itemCursor: 0,
    errorDetail: null,
    summary: { total: 0, committed: 0, previewVerified: 0, verifiedLive: 0, failed: 0, noop: 0 },
    prevContents: {},
    createdAt: now,
    updatedAt: now,
    items: [],
    ...overrides,
  }
}

describe('mergeRunForSave phase merge during recovery', () => {
  it('does not let a db phase=done override an in-progress recovery phase', () => {
    const incoming = run({ phase: 'verify_production_next', status: 'running', mergedByCustomer: true })
    const fresh = { phase: 'done', preview_url: null, status: 'failed', item_cursor: 0 }
    const merged = mergeRunForSave(incoming, fresh as unknown as Record<string, unknown>)
    expect(merged.phase).toBe('verify_production_next')
    expect(merged.status).toBe('running')
  })

  it('still allows db to override forward phase when not recovering', () => {
    const incoming = run({ phase: 'verify_preview_next', status: 'running', mergedByCustomer: false, mergedAt: null })
    const fresh = { phase: 'await_approval', preview_url: null, status: 'running', item_cursor: 0 }
    const merged = mergeRunForSave(incoming, fresh as unknown as Record<string, unknown>)
    expect(merged.phase).toBe('await_approval')
  })
})


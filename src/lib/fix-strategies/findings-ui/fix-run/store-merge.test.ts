import { describe, expect, it } from 'vitest'
import { mergeRunForSave, pickForwardItemStatus } from './store'
import type { FixRun } from './types'

function baseRun(over: Partial<FixRun> = {}): FixRun {
  return {
    id: 'r1',
    userId: 'u1',
    siteId: 's1',
    status: 'running',
    phase: 'wait_preview',
    branchName: 'b',
    prNumber: 1,
    prUrl: 'https://example.com/pr/1',
    previewUrl: null,
    mergeSha: null,
    approvedAt: null,
    autoMergeAttempted: false,
    autoMergeBlockedReason: null,
    itemCursor: 0,
    errorDetail: null,
    prevContents: {},
    items: [],
    summary: {
      total: 0,
      committed: 0,
      previewVerified: 0,
      verifiedLive: 0,
      failed: 0,
      noop: 0,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('pickForwardItemStatus', () => {
  it('does not regress preview_verified to committed', () => {
    expect(pickForwardItemStatus('preview_verified', 'committed')).toBe(
      'preview_verified',
    )
  })

  it('allows forward progress', () => {
    expect(pickForwardItemStatus('committed', 'preview_verified')).toBe(
      'preview_verified',
    )
  })

  it('allows failure', () => {
    expect(pickForwardItemStatus('committed', 'failed')).toBe('failed')
  })
})

describe('mergeRunForSave', () => {
  it('keeps DB verify_preview_next over stale wait_preview', () => {
    const merged = mergeRunForSave(baseRun({ phase: 'wait_preview' }), {
      phase: 'verify_preview_next',
      preview_url: 'https://x-abc.vercel.app',
      status: 'running',
    })
    expect(merged.phase).toBe('verify_preview_next')
    expect(merged.previewUrl).toBe('https://x-abc.vercel.app')
  })

  it('keeps incoming failure', () => {
    const merged = mergeRunForSave(
      baseRun({ phase: 'wait_preview', status: 'failed' }),
      { phase: 'verify_preview_next', preview_url: 'https://x.vercel.app', status: 'running' },
    )
    expect(merged.status).toBe('failed')
  })
})

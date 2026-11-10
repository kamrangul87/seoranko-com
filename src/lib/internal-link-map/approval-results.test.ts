import { describe, expect, it } from 'vitest'
import { summarizeApprovalBatch } from './approval-results'

describe('summarizeApprovalBatch', () => {
  it('reports one shared PR when several pages land on the same URL', () => {
    const msg = summarizeApprovalBatch([
      {
        id: '1',
        label: '/a.html',
        ok: true,
        prUrl: 'https://github.com/ex/repo/pull/12',
      },
      {
        id: '2',
        label: '/b.html',
        ok: true,
        prUrl: 'https://github.com/ex/repo/pull/12',
      },
    ])
    expect(msg).toMatch(/1 PR/)
    expect(msg).not.toMatch(/2 PRs/)
    expect(msg).toMatch(/does not merge/i)
  })
})

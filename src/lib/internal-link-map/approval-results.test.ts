import { describe, expect, it } from 'vitest'
import {
  fixActionError,
  summarizeApprovalBatch,
} from './approval-results'

describe('fixActionError', () => {
  it('prefers the server error body over a generic HTTP status', () => {
    expect(
      fixActionError(
        {
          error:
            'This finding is not auto-fixable. Human-review and report-only findings cannot enter the fix flow.',
        },
        false,
        400,
      ),
    ).toBe(
      'This finding is not auto-fixable. Human-review and report-only findings cannot enter the fix flow.',
    )
  })

  it('surfaces a 200 commit that actually failed', () => {
    expect(
      fixActionError(
        {
          fixFlow: {
            step: 'failed',
            errorDetail: 'Could not read public/blog/x.html from owner/repo',
            commitDetail: 'read failed',
          },
        },
        true,
        200,
      ),
    ).toBe('Could not read public/blog/x.html from owner/repo')
  })
})

describe('summarizeApprovalBatch', () => {
  it('reports per-item results for Approve all selected', () => {
    const summary = summarizeApprovalBatch([
      {
        id: '43f462f0-8d11-414f-815a-da5a9f7c9fd2',
        label: '/blog/mot-retest-cost-uk-2026.html',
        ok: true,
        prUrl: 'https://github.com/example/repo/pull/12',
      },
      {
        id: '6541541c-65da-4e86-a390-9e5d7306de19',
        label: '/blog/mot-advisories-explained-uk.html',
        ok: false,
        error:
          'This finding is not auto-fixable. Human-review and report-only findings cannot enter the fix flow.',
      },
    ])
    expect(summary).toMatch(/1 PR opened/)
    expect(summary).toMatch(/does not merge/i)
    expect(summary).toContain('/blog/mot-advisories-explained-uk.html')
    expect(summary).toMatch(/not auto-fixable/)
  })
})

import { describe, expect, it } from 'vitest'
import { RELATED_TRANSFORM_VERSION } from '@/lib/fix-strategies/related-articles/anchors'
import {
  approvalStatusFrom,
  isRelatedReadingFinding,
  toLinkMapApproval,
} from './approvals'

describe('isRelatedReadingFinding', () => {
  it('matches only the related-articles verdict', () => {
    expect(
      isRelatedReadingFinding({
        topicId: 'related',
        verdict: 'auto-add-related-articles',
      }),
    ).toBe(true)
    expect(
      isRelatedReadingFinding({ topicId: '43', verdict: 'orphan-page' }),
    ).toBe(false)
  })
})

describe('approvalStatusFrom', () => {
  const finding = {
    status: 'open' as const,
    fixedAt: null as string | null,
    evidenceValues: { requiresApproval: true, neverAutoMerge: true } as Record<
      string,
      unknown
    > | null,
  }

  it('is pending with no fix flow', () => {
    expect(approvalStatusFrom({ finding, flow: null })).toBe('pending')
  })

  it('is approved after the Audit approve step', () => {
    expect(
      approvalStatusFrom({
        finding,
        flow: { step: 'approved', approvedAt: '2026-11-10', prUrl: null, mergedAt: null },
      }),
    ).toBe('approved')
  })

  it('is pr_opened once a PR url exists', () => {
    expect(
      approvalStatusFrom({
        finding,
        flow: {
          step: 'committed',
          approvedAt: '2026-11-10',
          prUrl: 'https://github.com/ex/repo/pull/12',
          mergedAt: null,
        },
      }),
    ).toBe('pr_opened')
  })

  it('is merged when the customer PR landed', () => {
    expect(
      approvalStatusFrom({
        finding: { ...finding, fixedAt: '2026-11-10', status: 'resolved' },
        flow: {
          step: 'verified',
          approvedAt: '2026-11-10',
          prUrl: 'https://github.com/ex/repo/pull/12',
          mergedAt: '2026-11-10',
        },
      }),
    ).toBe('merged')
  })

  it('is rejected when evidence records a reject', () => {
    expect(
      approvalStatusFrom({
        finding: {
          ...finding,
          evidenceValues: { ...finding.evidenceValues, rejected: true },
        },
        flow: null,
      }),
    ).toBe('rejected')
  })
})

describe('toLinkMapApproval', () => {
  it('marks an open old-transform PR as regenerable', () => {
    const item = toLinkMapApproval(
      {
        id: 'f-old',
        pageUrl: 'https://example.com/blog/a.html',
        detail: 'Add related reading',
        status: 'open',
        fixedAt: null,
        evidenceValues: {
          relatedTargets: [{ href: '/blog/b.html', anchorText: 'EV charging' }],
          neverAutoMerge: true,
        },
        proposedDiff: null,
      },
      {
        step: 'committed',
        approvedAt: '2026-11-10',
        prUrl: 'https://github.com/autodun-ai/autodun.com/pull/73',
        prNumber: 73,
        mergedAt: null,
      },
    )
    expect(item.status).toBe('pr_opened')
    expect(item.canRegenerate).toBe(true)
    expect(item.prUrl).toBe(
      'https://github.com/autodun-ai/autodun.com/pull/73',
    )
  })

  it('does not offer regenerate after the current transform version committed', () => {
    const item = toLinkMapApproval(
      {
        id: 'f-new',
        pageUrl: 'https://example.com/blog/a.html',
        detail: 'Add related reading',
        status: 'open',
        fixedAt: null,
        evidenceValues: {
          relatedTargets: [{ href: '/blog/b.html', anchorText: 'B' }],
          relatedTransformVersion: RELATED_TRANSFORM_VERSION,
          neverAutoMerge: true,
        },
        proposedDiff: null,
      },
      {
        step: 'committed',
        prUrl: 'https://github.com/ex/repo/pull/90',
        mergedAt: null,
      },
    )
    expect(item.canRegenerate).toBe(false)
  })

  it('exposes targets and never claims a merge from a pending row', () => {
    const item = toLinkMapApproval({
      id: 'f1',
      pageUrl: 'https://example.com/blog/a.html',
      detail: 'Add related reading',
      status: 'open',
      fixedAt: null,
      evidenceValues: {
        relatedTargets: [{ href: '/blog/b.html', anchorText: 'B' }],
        neverAutoMerge: true,
      },
      proposedDiff: null,
    }, null)
    expect(item.status).toBe('pending')
    expect(item.prUrl).toBeNull()
    expect(item.targets).toEqual([{ href: '/blog/b.html', anchorText: 'B' }])
    expect(item.neverAutoMerge).toBe(true)
    expect(item.canRegenerate).toBe(false)
  })
})

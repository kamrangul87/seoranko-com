import { describe, expect, it } from 'vitest'
import { evaluateLinkMapApprovals } from './evaluate-approvals'
import type { ApprovalFindingInput, ApprovalFlowInput } from './approvals'

function finding(
  id: string,
  extra: Partial<ApprovalFindingInput> & {
    evidenceValues?: Record<string, unknown> | null
  } = {},
): ApprovalFindingInput {
  return {
    id,
    pageUrl: extra.pageUrl ?? 'https://autodun.com/blog/a.html',
    detail: extra.detail ?? 'Add related reading',
    status: extra.status ?? 'open',
    fixedAt: extra.fixedAt ?? null,
    evidenceValues: extra.evidenceValues ?? {
      relatedTargets: [{ href: '/blog/b.html', anchorText: 'MOT History Check UK' }],
      neverAutoMerge: true,
      requiresApproval: true,
    },
    proposedDiff: extra.proposedDiff ?? null,
  }
}

describe('evaluateLinkMapApprovals', () => {
  it('keeps pending content findings in the actionable list, strongest first', () => {
    const result = evaluateLinkMapApprovals({
      rows: [
        {
          finding: finding('weak', {
            pageUrl: 'https://autodun.com/blog/weak.html',
            evidenceValues: {
              relatedTargets: [
                { href: '/a', anchorText: 'MOT History Check UK', score: 0.2 },
              ],
              neverAutoMerge: true,
            },
          }),
          flow: null,
        },
        {
          finding: finding('strong', {
            pageUrl: 'https://autodun.com/blog/strong.html',
            evidenceValues: {
              relatedTargets: [
                { href: '/b', anchorText: 'MOT Cost UK 2026', score: 0.9 },
              ],
              neverAutoMerge: true,
            },
          }),
          flow: null,
        },
      ],
    })
    expect(result.items.map((i) => i.id)).toEqual(['strong', 'weak'])
    expect(result.history).toEqual([])
    expect(result.obsoleteWrites).toEqual([])
    expect(result.items.every((i) => i.neverAutoMerge)).toBe(true)
  })

  it('obsoletes a PR-opened utility-page finding instead of leaving it actionable', () => {
    const flow: ApprovalFlowInput = {
      step: 'committed',
      prUrl: 'https://github.com/kamrangul87/autodun-ai/pull/69',
      prNumber: 69,
      mergedAt: null,
    }
    const result = evaluateLinkMapApprovals({
      rows: [
        {
          finding: finding('about-pr', {
            pageUrl:
              'https://autodun.com/blog/electric-car-mot-whats-checked-uk-2026.html',
            evidenceValues: {
              relatedTargets: [
                {
                  href: '/about',
                  anchorText:
                    "About Autodun: The UK's Smarter Car Ownership Platform (2026)",
                },
              ],
              linkHealthKind: 'orphan-footer-only',
              neverAutoMerge: true,
            },
          }),
          flow,
        },
      ],
    })
    expect(result.items).toEqual([])
    expect(result.history).toEqual([])
    expect(result.obsoleteWrites).toHaveLength(1)
    expect(result.obsoleteWrites[0]?.findingId).toBe('about-pr')
    expect(result.obsoleteWrites[0]?.evidenceValues.obsolete).toBe(true)
    expect(result.obsoleteWrites[0]?.evidenceValues.dismissedReason).toBe(
      'utility-page',
    )
  })

  it('obsoletes approved rows with truncated pre-v3 anchors and hides them', () => {
    const result = evaluateLinkMapApprovals({
      rows: [
        {
          finding: finding('cut-off', {
            pageUrl: 'https://autodun.com/blog/mot-advisories-explained-uk.html',
            evidenceValues: {
              relatedTargets: [
                { href: '/blog/mot-history-check-uk.html', anchorText: 'How to find' },
                { href: '/blog/mot-cost-uk-2026.html', anchorText: 'MOT cost in' },
              ],
              neverAutoMerge: true,
            },
          }),
          flow: { step: 'approved', approvedAt: '2026-11-10', prUrl: null },
        },
      ],
    })
    expect(result.items).toEqual([])
    expect(result.history).toEqual([])
    expect(result.obsoleteWrites[0]?.evidenceValues.dismissedReason).toBe(
      'truncated-anchor',
    )
  })

  it('obsoletes a closed unmerged customer PR and never claims a merge', () => {
    const prUrl = 'https://github.com/kamrangul87/autodun-ai/pull/69'
    const result = evaluateLinkMapApprovals({
      rows: [
        {
          finding: finding('closed-pr', {
            evidenceValues: {
              relatedTargets: [
                {
                  href: '/blog/mot-advisories-explained-uk.html',
                  anchorText: 'MOT advisories explained',
                },
              ],
              relatedTransformVersion: 3,
              neverAutoMerge: true,
            },
          }),
          flow: { step: 'committed', prUrl, prNumber: 69, mergedAt: null },
        },
      ],
      customerPrByUrl: new Map([
        [prUrl, { state: 'closed', merged: false }],
      ]),
    })
    expect(result.items).toEqual([])
    expect(result.history).toEqual([])
    expect(result.obsoleteWrites[0]?.evidenceValues.dismissedReason).toBe(
      'pr-closed-unmerged',
    )
  })

  it('keeps an open customer PR in the actionable list', () => {
    const prUrl = 'https://github.com/ex/repo/pull/12'
    const result = evaluateLinkMapApprovals({
      rows: [
        {
          finding: finding('open-pr', {
            evidenceValues: {
              relatedTargets: [
                { href: '/blog/b.html', anchorText: 'MOT History Check UK', score: 0.8 },
              ],
              relatedTransformVersion: 3,
              neverAutoMerge: true,
            },
          }),
          flow: { step: 'committed', prUrl, prNumber: 12, mergedAt: null },
        },
      ],
      customerPrByUrl: new Map([[prUrl, { state: 'open', merged: false }]]),
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.status).toBe('pr_opened')
    expect(result.items[0]?.prNumber).toBe(12)
    expect(result.history).toEqual([])
    expect(result.obsoleteWrites).toEqual([])
  })

  it('moves merged findings to History with their verify badge', () => {
    const result = evaluateLinkMapApprovals({
      rows: [
        {
          finding: finding('merged', {
            status: 'resolved',
            fixedAt: '2026-11-10T12:00:00.000Z',
            evidenceValues: {
              relatedTargets: [
                { href: '/blog/b.html', anchorText: 'MOT History Check UK', score: 0.7 },
              ],
              relatedVerify: {
                verifiedAt: '2026-11-10T12:05:00.000Z',
                ok: true,
                links: [{ href: '/blog/b.html', ok: true, problems: [] }],
              },
              relatedTransformVersion: 3,
              neverAutoMerge: true,
            },
          }),
          flow: {
            step: 'verified',
            prUrl: 'https://github.com/ex/repo/pull/90',
            prNumber: 90,
            mergedAt: '2026-11-10T12:00:00.000Z',
          },
        },
      ],
    })
    expect(result.items).toEqual([])
    expect(result.history).toHaveLength(1)
    expect(result.history[0]?.status).toBe('merged')
    expect(result.history[0]?.verifyBadge).toBe('verified')
    expect(result.obsoleteWrites).toEqual([])
  })

  it('moves stale Approved (no PR) items to History when they are still valid', () => {
    const result = evaluateLinkMapApprovals({
      rows: [
        {
          finding: finding('approved', {
            evidenceValues: {
              relatedTargets: [
                { href: '/blog/b.html', anchorText: 'MOT History Check UK' },
              ],
              relatedTransformVersion: 3,
              neverAutoMerge: true,
            },
          }),
          flow: { step: 'approved', approvedAt: '2026-11-10', prUrl: null },
        },
      ],
    })
    expect(result.items).toEqual([])
    expect(result.history.map((i) => i.id)).toEqual(['approved'])
    expect(result.history[0]?.status).toBe('approved')
  })

  it('drops footer-only findings whose target now has in-content inlinks', () => {
    const result = evaluateLinkMapApprovals({
      rows: [
        {
          finding: finding('ulez', {
            pageUrl: 'https://autodun.com/blog/mot-changes-2026-dvsa-updates.html',
            evidenceValues: {
              linkHealthKind: 'orphan-footer-only',
              relatedTargets: [
                {
                  href: '/ulez-checker-uk',
                  anchorText:
                    'ULEZ Checker UK — What ULEZ Compliance Really Means for Drivers',
                },
              ],
              neverAutoMerge: true,
            },
          }),
          flow: { step: 'approved', approvedAt: '2026-11-10', prUrl: null },
        },
      ],
      inContentInlinkKeys: new Set([
        'https://autodun.com/ulez-checker-uk',
        '/ulez-checker-uk',
      ]),
    })
    expect(result.items).toEqual([])
    expect(result.history).toEqual([])
    expect(result.obsoleteWrites[0]?.evidenceValues.dismissedReason).toBe(
      'in-content-inlinks',
    )
  })

  it('hides already-obsolete evidence and never writes again', () => {
    const result = evaluateLinkMapApprovals({
      rows: [
        {
          finding: finding('gone', {
            evidenceValues: {
              relatedTargets: [{ href: '/about', anchorText: 'About' }],
              obsolete: true,
              dismissed: true,
              dismissedReason: 'utility-page',
            },
          }),
          flow: null,
        },
      ],
    })
    expect(result.items).toEqual([])
    expect(result.history).toEqual([])
    expect(result.obsoleteWrites).toEqual([])
  })

  it('never displays a truncated mid-phrase anchor on an actionable row', () => {
    const result = evaluateLinkMapApprovals({
      rows: [
        {
          finding: finding('pending-stub', {
            evidenceValues: {
              relatedTargets: [
                {
                  href: '/blog/mot-cost-uk-2026.html',
                  anchorText: 'MOT cost in',
                  score: 0.88,
                },
              ],
              neverAutoMerge: true,
            },
          }),
          flow: null,
        },
      ],
    })
    // Truncated stored anchors are obsolete, not rewritten in the live list.
    expect(result.items).toEqual([])
    expect(result.obsoleteWrites.length).toBe(1)
  })

  it('treats a GitHub-merged PR as History, not a SEORANKO merge', () => {
    const prUrl = 'https://github.com/ex/repo/pull/12'
    const result = evaluateLinkMapApprovals({
      rows: [
        {
          finding: finding('customer-merged', {
            evidenceValues: {
              relatedTargets: [
                { href: '/blog/b.html', anchorText: 'MOT History Check UK' },
              ],
              relatedTransformVersion: 3,
              neverAutoMerge: true,
            },
          }),
          flow: { step: 'committed', prUrl, prNumber: 12, mergedAt: null },
        },
      ],
      customerPrByUrl: new Map([
        [prUrl, { state: 'closed', merged: true, mergedAt: '2026-11-11T08:00:00.000Z' }],
      ]),
    })
    expect(result.items).toEqual([])
    expect(result.history[0]?.status).toBe('merged')
    expect(result.history[0]?.neverAutoMerge).toBe(true)
    expect(result.obsoleteWrites).toEqual([])
  })
})

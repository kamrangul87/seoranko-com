import { describe, expect, it } from 'vitest'
import { canOfferFix } from '../buckets'
import type { PersistedFindingRow } from '../crawl/constants'
import {
  applySourcePatch,
  blockedFixMessage,
  isRegisteredMechanicalFix,
  resolveRegisteredFindingSource,
  shouldResolveBeforeFix,
} from './prepare-registered-fix'

const now = '2026-11-10T08:00:00.000Z'

function productionRelatedRow(
  partial: Partial<PersistedFindingRow> = {},
): PersistedFindingRow {
  return {
    id: '43f462f0-8d11-414f-815a-da5a9f7c9fd2',
    siteId: '50b305a3-baab-49ce-8966-04796b8b27c4',
    detectOrigin: null,
    userId: 'user-1',
    topicId: 'related',
    kind: 'internal-links/related-articles',
    bucket: 'actionable',
    verdict: 'auto-add-related-articles',
    severity: null,
    rollupKey:
      'related|auto-add-related-articles|https://autodun.com/blog/mot-retest-cost-uk-2026.html',
    declarationSite:
      'https://autodun.com/blog/mot-retest-cost-uk-2026.html',
    affectedUrlCount: 1,
    pageUrl: 'https://autodun.com/blog/mot-retest-cost-uk-2026.html',
    detail: 'Add related reading links',
    autoFixable: true,
    reportOnly: false,
    surfaceClass: 'finding',
    proposedDiff: {
      proposed: {
        relatedTargets: [
          {
            href: '/blog/mot-cost-uk-2026.html',
            anchorText: 'MOT Cost in the UK 2026',
          },
        ],
      },
    },
    evidenceValues: {
      relatedTargets: [
        {
          href: '/blog/mot-cost-uk-2026.html',
          anchorText: 'MOT Cost in the UK 2026',
        },
      ],
      requiresApproval: true,
      neverAutoMerge: true,
    },
    sourceRows: [],
    sourcePath: null,
    sourceBlobSha: null,
    sourceResolvedAt: null,
    sourceUnresolvedReason: null,
    firstSeenRunId: null,
    lastSeenRunId: null,
    firstSeenAt: now,
    lastSeenAt: now,
    status: 'open',
    resolvedAt: null,
    fixedAt: null,
    verificationAt: null,
    postFixStatus: null,
    regressionObservedAt: null,
    acceptedAt: null,
    acceptedBy: null,
    acceptedFingerprint: null,
    ...partial,
  }
}

describe('prepare-registered-fix — hosted related-articles row', () => {
  it('treats the autodun Link-map row as a registered mechanical fix that still needs source resolve', () => {
    const row = productionRelatedRow()
    expect(row.id).toBe('43f462f0-8d11-414f-815a-da5a9f7c9fd2')
    expect(row.surfaceClass).toBe('finding')
    expect(row.autoFixable).toBe(true)
    expect(row.reportOnly).toBe(false)
    expect(row.sourceRows).toEqual([])
    expect(row.sourcePath).toBeNull()
    expect(canOfferFix(row.surfaceClass)).toBe(false)
    expect(isRegisteredMechanicalFix(row)).toBe(true)
    expect(shouldResolveBeforeFix(row)).toBe(true)
    expect(blockedFixMessage(row, false)).toMatch(/not auto-fixable/i)
  })

  it('promotes the hosted row after Audit-style page-file resolve, then canOfferFix', async () => {
    const row = productionRelatedRow({
      id: '6541541c-65da-4e86-a390-9e5d7306de19',
    })
    const patch = await resolveRegisteredFindingSource({
      row,
      listTree: async () => [
        { path: 'public/blog/mot-retest-cost-uk-2026.html', sha: 'sha-retest' },
      ],
      readFile: async () =>
        '<html><body><article><h1>MOT retest cost UK 2026</h1></article></body></html>',
    })
    const ready = applySourcePatch(row, patch)
    expect(ready.sourcePath).toBe('public/blog/mot-retest-cost-uk-2026.html')
    expect(ready.sourceBlobSha).toBe('sha-retest')
    expect(ready.surfaceClass).toBe('auto-fixable')
    expect(canOfferFix(ready.surfaceClass)).toBe(true)
    expect(blockedFixMessage(ready, false)).toBeNull()
    expect(shouldResolveBeforeFix(ready)).toBe(false)
  })

  it('still blocks real human-review and report-only findings', () => {
    const human = productionRelatedRow({
      verdict: 'human-review-related-articles',
      autoFixable: false,
      reportOnly: true,
      surfaceClass: 'human-review',
    })
    expect(isRegisteredMechanicalFix(human)).toBe(false)
    expect(shouldResolveBeforeFix(human)).toBe(false)
    expect(canOfferFix(human.surfaceClass)).toBe(false)
    expect(blockedFixMessage(human, false)).toMatch(/not auto-fixable/i)
  })
})

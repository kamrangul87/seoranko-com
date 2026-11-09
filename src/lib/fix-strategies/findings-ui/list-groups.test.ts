import { describe, expect, it } from 'vitest'
import {
  isOwnerActionableFinding,
  isReportOnlyOrInformational,
  ownerFacingFindingCounts,
  partitionPresentFindings,
} from './list-groups'
import type { UiFinding } from './types'

function ui(overrides: Partial<UiFinding> & Pick<UiFinding, 'id'>): UiFinding {
  return {
    topicId: '58',
    kind: 'topic/58',
    verdict: 'in-crawl-not-in-gsc-weak',
    severity: 'low',
    detail: 'weak',
    pageUrl: 'https://example.com/x',
    declarationSite: null,
    affectedUrlCount: 1,
    rolledUp: false,
    bucket: 'actionable',
    surfaceClass: 'report-only',
    autoFixable: false,
    reportOnly: true,
    proposedDiff: null,
    evidenceValues: null,
    sources: [],
    internalEvidence: [],
    dossierSlug: null,
    ownerPlainEnglish: 'Our crawl found this URL',
    sourceTier: 'OBSERVED',
    primarySourceId: null,
    whyNotAutoFixed: 'SEORANKO reports this for awareness',
    status: 'open',
    resolvedAt: null,
    fixedAt: null,
    verificationAt: null,
    postFixStatus: null,
    regressionObservedAt: null,
    acceptedAt: null,
    acceptedBy: null,
    ...overrides,
  }
}

describe('list-groups', () => {
  it('treats report-only Topic 58 as informational, not actionable', () => {
    const f = ui({ id: 't58' })
    expect(isReportOnlyOrInformational(f)).toBe(true)
    expect(isOwnerActionableFinding(f)).toBe(false)
  })

  it('treats stale stored Topic 58 as informational even if bucket is still actionable', () => {
    const f = ui({
      id: 'stale-58',
      bucket: 'actionable',
      surfaceClass: 'finding',
      reportOnly: false,
      verdict: 'in-crawl-not-in-gsc-weak',
    })
    expect(isReportOnlyOrInformational(f)).toBe(true)
    expect(partitionPresentFindings([f]).needsYou).toHaveLength(0)
    expect(partitionPresentFindings([f]).info.map((x) => x.id)).toEqual(['stale-58'])
  })

  it('keeps human-review Topic 72 in Needs you, not For information', () => {
    const f = ui({
      id: 't72',
      topicId: '72',
      verdict: 'human-review-jurisdiction-not-set',
      bucket: 'actionable',
      surfaceClass: 'human-review',
      reportOnly: false,
    })
    const parts = partitionPresentFindings([f])
    expect(parts.needsYou.map((x) => x.id)).toEqual(['t72'])
    expect(parts.info).toHaveLength(0)
  })

  it('excludes report-only from Needs you and the actionable count', () => {
    const report = ui({ id: 't58' })
    const human = ui({
      id: 't72',
      topicId: '72',
      verdict: 'human-review-jurisdiction-not-set',
      surfaceClass: 'human-review',
      reportOnly: false,
    })
    const parts = partitionPresentFindings([report, human])
    expect(parts.needsYou.map((x) => x.id)).toEqual(['t72'])
    expect(parts.info.map((x) => x.id)).toEqual(['t58'])
    expect(
      ownerFacingFindingCounts({
        counts: { actionable: 2, informational: 0, internal: 0 },
        findings: [report, human],
      }),
    ).toEqual({ actionable: 1, informational: 1, internal: 0 })
  })
})

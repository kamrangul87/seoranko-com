import { describe, expect, it } from 'vitest'
import {
  arePreferredUrlFormVariants,
  linkCrossTopicRootCauses,
  parseCanonicalElsewhereTarget,
  type LinkableFinding,
} from './link-cross-topic-root-causes'
import { rollupAndClassify, type DetectorEmit } from './run-detectors'
import { classifyVerdictBucket } from '../buckets'

function baseFinding(
  overrides: Partial<LinkableFinding> &
    Pick<LinkableFinding, 'topicId' | 'verdict' | 'pageUrl' | 'detail'>,
): LinkableFinding {
  return {
    bucket: 'actionable',
    reportOnly: true,
    surfaceClass: 'human-review',
    evidenceValues: null,
    ...overrides,
  }
}

describe('arePreferredUrlFormVariants', () => {
  it('matches trailing-slash twins', () => {
    expect(
      arePreferredUrlFormVariants(
        'https://autodun.com/blog',
        'https://autodun.com/blog/',
      ),
    ).toBe(true)
  })

  it('matches index.html twins', () => {
    expect(
      arePreferredUrlFormVariants(
        'https://autodun.com/blog',
        'https://autodun.com/blog/index.html',
      ),
    ).toBe(true)
  })

  it('matches slash ↔ index.html transitively', () => {
    expect(
      arePreferredUrlFormVariants(
        'https://autodun.com/blog/',
        'https://autodun.com/blog/index.html',
      ),
    ).toBe(true)
  })

  it('rejects unrelated paths', () => {
    expect(
      arePreferredUrlFormVariants(
        'https://autodun.com/blog',
        'https://autodun.com/about',
      ),
    ).toBe(false)
  })
})

describe('parseCanonicalElsewhereTarget', () => {
  it('parses topic 26 detail arrow', () => {
    expect(
      parseCanonicalElsewhereTarget(
        'Canonicalises elsewhere → https://autodun.com/blog/index.html',
      ),
    ).toBe('https://autodun.com/blog/index.html')
  })
})

describe('linkCrossTopicRootCauses', () => {
  it('demotes topic 26 canonical-elsewhere onto topic 8 preferred-conflict', () => {
    const findings = [
      baseFinding({
        topicId: '8',
        verdict: 'human-review-preferred-conflict',
        pageUrl: 'https://autodun.com/blog',
        detail: 'sitemap prefers /blog; canonical prefers /blog/index.html',
        evidenceValues: {
          memberUrls: [
            'https://autodun.com/blog',
            'https://autodun.com/blog/',
            'https://autodun.com/blog/index.html',
          ],
        },
      }),
      baseFinding({
        topicId: '26',
        verdict: 'human-review-canonical-elsewhere',
        pageUrl: 'https://autodun.com/blog',
        detail:
          'Canonicalises elsewhere → https://autodun.com/blog/index.html',
      }),
      baseFinding({
        topicId: '25',
        verdict: 'moderate-out-of-scope',
        pageUrl: 'https://autodun.com/sitemap.xml',
        detail: 'unrelated',
      }),
    ]

    linkCrossTopicRootCauses(findings)

    const t8 = findings.find((f) => f.topicId === '8')!
    const t26 = findings.find((f) => f.topicId === '26')!
    const t25 = findings.find((f) => f.topicId === '25')!

    expect(t8.bucket).toBe('actionable')
    expect(t8.evidenceValues?.rootCause).toBe('preferred-url-form')
    expect(t8.evidenceValues?.relatedFindings).toEqual([
      expect.objectContaining({
        topicId: '26',
        verdict: 'human-review-canonical-elsewhere',
        relationship: 'symptom',
        pageUrl: 'https://autodun.com/blog',
      }),
    ])
    expect(t26.bucket).toBe('internal')
    expect(t26.surfaceClass).toBe('internal')
    expect(t25.bucket).toBe('actionable')
  })

  it('does not link when canonical points at a different page', () => {
    const findings = [
      baseFinding({
        topicId: '8',
        verdict: 'human-review-preferred-conflict',
        pageUrl: 'https://autodun.com/blog',
        detail: 'conflict',
      }),
      baseFinding({
        topicId: '26',
        verdict: 'human-review-canonical-elsewhere',
        pageUrl: 'https://autodun.com/blog',
        detail: 'Canonicalises elsewhere → https://autodun.com/about',
      }),
    ]

    linkCrossTopicRootCauses(findings)

    expect(findings[1]!.bucket).toBe('actionable')
    expect(findings[0]!.evidenceValues?.relatedFindings).toBeUndefined()
  })

  it('rollupAndClassify links autodun-shaped emits', () => {
    const emits: DetectorEmit[] = [
      {
        topicId: '8',
        kind: 'duplicate-url/index-html',
        verdict: 'human-review-preferred-conflict',
        severity: null,
        detail: 'preferred form conflict',
        pageUrl: 'https://autodun.com/blog',
        declarationSite: 'config:next.config.js',
        autoFixable: false,
        proposedDiff: null,
        evidenceValues: null,
        bucket: classifyVerdictBucket('human-review-preferred-conflict'),
      },
      {
        topicId: '8',
        kind: 'duplicate-url/trailing-slash',
        verdict: 'human-review-preferred-conflict',
        severity: null,
        detail: 'preferred form conflict',
        pageUrl: 'https://autodun.com/blog/',
        declarationSite: 'config:next.config.js',
        autoFixable: false,
        proposedDiff: null,
        evidenceValues: null,
        bucket: classifyVerdictBucket('human-review-preferred-conflict'),
      },
      {
        topicId: '8',
        kind: 'duplicate-url/index-html',
        verdict: 'human-review-preferred-conflict',
        severity: null,
        detail: 'preferred form conflict',
        pageUrl: 'https://autodun.com/blog/index.html',
        declarationSite: 'config:next.config.js',
        autoFixable: false,
        proposedDiff: null,
        evidenceValues: null,
        bucket: classifyVerdictBucket('human-review-preferred-conflict'),
      },
      {
        topicId: '26',
        kind: 'sitemap/not-indexable',
        verdict: 'human-review-canonical-elsewhere',
        severity: null,
        detail:
          'Canonicalises elsewhere → https://autodun.com/blog/index.html',
        pageUrl: 'https://autodun.com/blog',
        declarationSite: null,
        autoFixable: false,
        proposedDiff: null,
        evidenceValues: null,
        bucket: classifyVerdictBucket('human-review-canonical-elsewhere'),
      },
    ]

    const { findings } = rollupAndClassify(emits)
    const actionable = findings.filter((f) => f.bucket === 'actionable')
    const t8 = actionable.find((f) => f.topicId === '8')
    const t26Actionable = actionable.filter((f) => f.topicId === '26')
    const t26Internal = findings.find(
      (f) =>
        f.topicId === '26' &&
        f.verdict === 'human-review-canonical-elsewhere',
    )

    expect(t8).toBeTruthy()
    expect(t8!.affectedUrlCount).toBe(3)
    expect(t8!.evidenceValues?.relatedFindings).toHaveLength(1)
    expect(t26Actionable).toHaveLength(0)
    expect(t26Internal?.bucket).toBe('internal')
  })
})

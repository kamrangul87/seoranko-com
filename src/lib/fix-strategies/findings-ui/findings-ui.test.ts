import { describe, expect, it } from 'vitest'
import {
  classifyVerdictBucket,
  classifySurfaceClass,
  isListVisible,
  canOfferFix,
} from './buckets'
import { buildDemoFindings, DEMO_RUN_META } from './demo-run'
import { sourcesForDossier, _setSourceRowsForTest } from './sources'

describe('findings-ui buckets', () => {
  it('keeps suppress/ok/route internal', () => {
    expect(classifyVerdictBucket('suppress-unknown-type')).toBe('internal')
    expect(classifyVerdictBucket('ok')).toBe('internal')
    expect(classifyVerdictBucket('ok-no-redirect')).toBe('internal')
    expect(classifyVerdictBucket('route-topic-43-depth-undefined')).toBe(
      'internal',
    )
  })

  it('classifies actionable and informational', () => {
    expect(classifyVerdictBucket('human-review-entity-url-mismatch')).toBe(
      'actionable',
    )
    expect(classifyVerdictBucket('auto-set-dimensions')).toBe('actionable')
    expect(classifyVerdictBucket('finding-wrong-ratio')).toBe('actionable')
    expect(classifyVerdictBucket('informational-recommended-absent')).toBe(
      'informational',
    )
  })

  it('never lists internal rows', () => {
    expect(
      isListVisible('internal', { includeInformational: true }),
    ).toBe(false)
    expect(
      isListVisible('actionable', { includeInformational: false }),
    ).toBe(true)
    expect(
      isListVisible('informational', { includeInformational: false }),
    ).toBe(false)
    expect(
      isListVisible('informational', { includeInformational: true }),
    ).toBe(true)
  })

  it('offers fix only for auto-fixable', () => {
    expect(canOfferFix('auto-fixable')).toBe(true)
    expect(canOfferFix('human-review')).toBe(false)
    expect(canOfferFix('report-only')).toBe(false)
    expect(canOfferFix('finding')).toBe(false)
    expect(canOfferFix('informational')).toBe(false)
  })

  it('marks human-review surface', () => {
    expect(
      classifySurfaceClass('human-review-entity-url-mismatch', {
        autoFixable: false,
        reportOnly: true,
      }),
    ).toBe('human-review')
    expect(
      classifySurfaceClass('auto-set-dimensions', { autoFixable: true }),
    ).toBe('auto-fixable')
  })
})

describe('demo findings run', () => {
  it('matches post-rollup autodun user-facing counts', () => {
    const all = buildDemoFindings()
    const actionable = all.filter((f) => f.bucket === 'actionable')
    const informational = all.filter((f) => f.bucket === 'informational')
    expect(actionable).toHaveLength(10)
    expect(informational).toHaveLength(17)
    expect(all.every((f) => f.bucket !== 'internal')).toBe(true)
    expect(DEMO_RUN_META.internalCount).toBe(349)

    const listDefault = all.filter((f) =>
      isListVisible(f.bucket, { includeInformational: false }),
    )
    expect(listDefault).toHaveLength(10)

    const rolled = actionable.filter((f) => f.rolledUp)
    expect(rolled.every((f) => f.declarationSite && f.affectedUrlCount > 1)).toBe(
      true,
    )

    const auto = actionable.filter((f) => f.autoFixable)
    expect(auto.length).toBe(1)
    expect(auto[0]!.verdict).toBe('auto-set-dimensions')
    expect(canOfferFix(auto[0]!.surfaceClass)).toBe(true)

    for (const f of actionable.filter((x) => !x.autoFixable)) {
      expect(canOfferFix(f.surfaceClass)).toBe(false)
    }
  })
})

describe('sources lookup', () => {
  it('resolves citations for a dossier', () => {
    _setSourceRowsForTest([
      {
        sourceId: 80,
        url: 'https://developers.google.com/search/docs/appearance/structured-data/sd-policies',
        section: 'Structured data general guidelines',
        requirement: 'Required vs recommended',
        verifiedOn: '2026-09-15',
        usedBy: ['structured-data__contradicts_visible_page'],
      },
    ])
    const src = sourcesForDossier('structured-data__contradicts_visible_page')
    expect(src).toHaveLength(1)
    expect(src[0]!.verifiedOn).toBe('2026-09-15')
    expect(src[0]!.url).toMatch(/structured-data/)
    _setSourceRowsForTest(null)
  })
})

import { describe, expect, it } from 'vitest'
import {
  OWNER_PLAIN_ENGLISH,
  WHY_NOT_FIXED,
  ownerPlainEnglish,
  whyNotFixed,
  whyNotFixedOrFallback,
  sourceTierForTopic,
  primarySourceIdForTopic,
  whyFindingNotAutoFixed,
} from './owner-copy'
import { classifyVerdictBucket } from './buckets'
import { aggregateLeftAlone, persistedToUiFinding } from './map-persisted'
import { buildDemoFindings } from './demo-run'
import type { PersistedFindingRow } from './crawl/constants'

describe('owner-copy plain English', () => {
  it('covers user tone examples without ranking claims', () => {
    expect(ownerPlainEnglish('auto-set-dimensions')).toBe(
      'Your page may visibly jump around while images load.',
    )
    expect(ownerPlainEnglish('finding-absent-duplicates-proven')).toMatch(
      /two different things/,
    )
    expect(ownerPlainEnglish('auto-remove-confirmed-4xx')).toMatch(
      /no longer exists/,
    )
    expect(ownerPlainEnglish('d17-faq-markup-not-visible')).toMatch(
      /cannot see/,
    )
    for (const s of Object.values(OWNER_PLAIN_ENGLISH)) {
      expect(s.toLowerCase()).not.toMatch(/\brank(ing|s)?\b/)
    }
  })

  it('maps every suppress/route/skip/ok in WHY_NOT_FIXED', () => {
    for (const v of Object.keys(WHY_NOT_FIXED)) {
      expect(classifyVerdictBucket(v)).toBe('internal')
      expect(whyNotFixed(v)).toBeTruthy()
    }
    expect(whyNotFixedOrFallback('suppress-brand-new-unknown')).toMatch(
      /left it alone/,
    )
    expect(whyNotFixedOrFallback('route-topic-99-example')).toMatch(/Routed/)
  })

  it('assigns source tiers and primary ids for shipped topics', () => {
    expect(sourceTierForTopic('49')).toBe('STANDARD')
    expect(primarySourceIdForTopic('49')).toBe(92)
    expect(sourceTierForTopic('38')).toBe('VENDOR-DOCUMENTED')
    expect(sourceTierForTopic('999')).toBe('SEORANKO PRODUCT DECISION')
  })

  it('explains why non-auto findings were not fixed', () => {
    expect(
      whyFindingNotAutoFixed({
        autoFixable: true,
        reportOnly: false,
        surfaceClass: 'auto-fixable',
      }),
    ).toBeNull()
    expect(
      whyFindingNotAutoFixed({
        autoFixable: false,
        reportOnly: true,
        surfaceClass: 'human-review',
      }),
    ).toMatch(/judgment/)
  })
})

describe('map-persisted owner fields', () => {
  it('attaches plain English, tier, and why-not-fixed on evidence', () => {
    const row: PersistedFindingRow = {
      id: 'f1',
      siteId: 's1',
      detectOrigin: null,
      userId: 'u1',
      topicId: '49',
      kind: 'performance/img-missing-dimensions',
      verdict: 'auto-set-dimensions',
      severity: 'high',
      detail: 'missing width/height',
      pageUrl: 'https://example.com/',
      declarationSite: null,
      rollupKey: 'k',
      affectedUrlCount: 1,
      bucket: 'actionable',
      autoFixable: true,
      reportOnly: false,
      surfaceClass: 'auto-fixable',
      proposedDiff: null,
      evidenceValues: null,
      sourceRows: [],
      firstSeenRunId: 'r1',
      lastSeenRunId: 'r1',
      firstSeenAt: '2026-01-01T00:00:00Z',
      lastSeenAt: '2026-01-01T00:00:00Z',
      status: 'open',
      resolvedAt: null,
    }
    const ui = persistedToUiFinding(row, [
      {
        id: 'e1',
        findingId: 'f1',
        runId: 'r1',
        topicId: '49',
        verdict: 'skip-svg-viewbox',
        detail: 'svg exempt',
        pageUrl: null,
      },
    ])
    expect(ui.ownerPlainEnglish).toMatch(/jump/)
    expect(ui.sourceTier).toBe('STANDARD')
    expect(ui.primarySourceId).toBe(92)
    expect(ui.whyNotAutoFixed).toBeNull()
    expect(ui.internalEvidence[0]!.whyNotFixed).toMatch(/viewBox/)
    expect(aggregateLeftAlone([ui])[0]!.verdict).toBe('skip-svg-viewbox')
  })

  it('demo findings carry owner fields and never list internals', () => {
    const all = buildDemoFindings()
    expect(all.every((f) => f.ownerPlainEnglish)).toBe(true)
    expect(all.every((f) => f.sourceTier)).toBe(true)
    expect(all.every((f) => f.bucket !== 'internal')).toBe(true)
    const withEvidence = all.find((f) => f.internalEvidence.length > 0)!
    expect(withEvidence.internalEvidence.every((e) => e.whyNotFixed)).toBe(
      true,
    )
  })
})

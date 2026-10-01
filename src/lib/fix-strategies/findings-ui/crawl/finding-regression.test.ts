import { describe, expect, it, beforeEach } from 'vitest'
import {
  buildRegressionReport,
  createMemoryFindingsStore,
  lookupOutcomeLedgerPr,
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
} from './index'
import type { RolledPersistCandidate } from './run-detectors'

function makeFinding(
  overrides: Partial<RolledPersistCandidate> = {},
): RolledPersistCandidate {
  return {
    topicId: '13',
    kind: 'canonical/tag-absent',
    verdict: 'auto-add-canonical',
    severity: 'medium',
    detail: 'no canonical tag',
    pageUrl: 'https://example.com/page',
    declarationSite: null,
    rollupKey: '13|auto-add-canonical|https://example.com/page',
    affectedUrlCount: 1,
    rolledUp: false,
    bucket: 'actionable' as const,
    autoFixable: true,
    reportOnly: false,
    surfaceClass: 'auto-fixable',
    proposedDiff: null,
    evidenceValues: null,
    sourceRows: [],
    ...overrides,
  }
}

describe('Change Monitoring 3.2 — regression fields (acceptance)', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
  })

  it('seed → resolve → reintroduce reports REGRESSION on the same finding id', async () => {
    const store = createMemoryFindingsStore()

    // Run 1: seed finding
    const run1 = await store.createRun({
      siteId: 'site-reg',
      userId: 'user-a',
      origin: 'https://example.com',
    })
    await store.upsertFindings({
      siteId: 'site-reg',
      userId: 'user-a',
      runId: run1.id,
      findings: [makeFinding()],
      internalEvidence: [],
    })
    const [seeded] = await store.listFindings({
      siteId: 'site-reg',
      includeInformational: false,
    })
    expect(seeded!.status).toBe('open')
    expect(seeded!.firstSeenAt).toBeTruthy()
    expect(seeded!.lastSeenAt).toBeTruthy()
    expect(seeded!.resolvedAt).toBeNull()
    expect(seeded!.regressionObservedAt).toBeNull()
    const findingId = seeded!.id

    // Run 2: condition gone → resolve
    const run2 = await store.createRun({
      siteId: 'site-reg',
      userId: 'user-a',
      origin: 'https://example.com',
    })
    await store.upsertFindings({
      siteId: 'site-reg',
      userId: 'user-a',
      runId: run2.id,
      findings: [],
      internalEvidence: [],
    })
    await store.resolveAbsentFindings({
      siteId: 'site-reg',
      userId: 'user-a',
      runId: run2.id,
      assessedPageUrls: ['https://example.com/page'],
      fullCoverage: true,
    })
    const [resolved] = await store.listFindings({
      siteId: 'site-reg',
      includeInformational: false,
    })
    expect(resolved!.id).toBe(findingId)
    expect(resolved!.status).toBe('resolved')
    expect(resolved!.resolvedAt).not.toBeNull()

    // Run 3: condition back → REGRESSION (same row, not a new finding).
    // Advance past seed lastSeenAt — ISO timestamps are ms-resolution and the
    // whole seed→resolve→reintroduce path can finish in the same millisecond.
    await new Promise((r) => setTimeout(r, 5))
    const run3 = await store.createRun({
      siteId: 'site-reg',
      userId: 'user-a',
      origin: 'https://example.com',
    })
    await store.upsertFindings({
      siteId: 'site-reg',
      userId: 'user-a',
      runId: run3.id,
      findings: [makeFinding()],
      internalEvidence: [],
    })
    const rows = await store.listFindings({
      siteId: 'site-reg',
      includeInformational: false,
    })
    expect(rows).toHaveLength(1)
    const regressed = rows[0]!
    expect(regressed.id).toBe(findingId)
    expect(regressed.status).toBe('regressed')
    expect(regressed.regressionObservedAt).not.toBeNull()
    expect(regressed.resolvedAt).toBe(resolved!.resolvedAt)
    expect(regressed.firstSeenAt).toBe(seeded!.firstSeenAt)
    expect(regressed.lastSeenAt).not.toBe(seeded!.lastSeenAt)

    const report = buildRegressionReport(regressed)
    expect(report.isRegression).toBe(true)
    expect(report.headline).toBe('REGRESSION')
    expect(report.sameFindingId).toBe(findingId)
    expect(report.detail).toMatch(/same finding/i)
    expect(report.detail).not.toMatch(/new finding/i)

    // Acceptance output (printed for the Stage 2 report)
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          acceptance: 'seed→resolve→reintroduce',
          findingId: regressed.id,
          status: regressed.status,
          first_seen_at: regressed.firstSeenAt,
          last_seen_at: regressed.lastSeenAt,
          resolved_at: regressed.resolvedAt,
          fixed_at: regressed.fixedAt,
          verification_at: regressed.verificationAt,
          post_fix_status: regressed.postFixStatus,
          regression_observed_at: regressed.regressionObservedAt,
          report,
        },
        null,
        2,
      ),
    )
  })

  it('SEORANKO-fixed finding names the PR when it regresses', async () => {
    const store = createMemoryFindingsStore()
    const run1 = await store.createRun({
      siteId: 'site-pr',
      userId: 'user-a',
      origin: 'https://example.com',
    })
    await store.upsertFindings({
      siteId: 'site-pr',
      userId: 'user-a',
      runId: run1.id,
      findings: [makeFinding()],
      internalEvidence: [],
    })
    const [seeded] = await store.listFindings({
      siteId: 'site-pr',
      includeInformational: false,
    })

    // SEORANKO fix stamped (same lifecycle row)
    await store.recordSeorankoFix({
      findingId: seeded!.id,
      fixedAt: '2026-09-22T06:41:58.000Z',
      verificationAt: '2026-09-22T06:44:00.000Z',
      postFixStatus: 'verified',
    })

    const run2 = await store.createRun({
      siteId: 'site-pr',
      userId: 'user-a',
      origin: 'https://example.com',
    })
    await store.upsertFindings({
      siteId: 'site-pr',
      userId: 'user-a',
      runId: run2.id,
      findings: [],
      internalEvidence: [],
    })
    await store.resolveAbsentFindings({
      siteId: 'site-pr',
      userId: 'user-a',
      runId: run2.id,
      assessedPageUrls: ['https://example.com/page'],
      fullCoverage: true,
    })

    const run3 = await store.createRun({
      siteId: 'site-pr',
      userId: 'user-a',
      origin: 'https://example.com',
    })
    await store.upsertFindings({
      siteId: 'site-pr',
      userId: 'user-a',
      runId: run3.id,
      findings: [makeFinding()],
      internalEvidence: [],
    })

    const [regressed] = await store.listFindings({
      siteId: 'site-pr',
      includeInformational: false,
    })
    expect(regressed!.id).toBe(seeded!.id)
    expect(regressed!.status).toBe('regressed')
    expect(regressed!.postFixStatus).toBe('regressed')
    expect(regressed!.fixedAt).toBe('2026-09-22T06:41:58.000Z')
    expect(regressed!.verificationAt).toBe('2026-09-22T06:44:00.000Z')

    const report = buildRegressionReport(regressed!, {
      fixFlow: {
        prUrl: 'https://github.com/kamrangul87/autodun-ai/pull/34',
        prNumber: 34,
      },
    })
    expect(report.isRegression).toBe(true)
    expect(report.headline).toBe('REGRESSION')
    expect(report.fixPr?.prNumber).toBe(34)
    expect(report.detail).toMatch(/PR #34/)
    expect(report.detail).toMatch(/reverted or undone/)
    expect(report.detail).toMatch(/FIX_VERIFY_OUTCOME_RECORD/)

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          acceptance: 'seoranko-fix-names-pr-on-regression',
          findingId: regressed!.id,
          status: regressed!.status,
          post_fix_status: regressed!.postFixStatus,
          fixed_at: regressed!.fixedAt,
          verification_at: regressed!.verificationAt,
          regression_observed_at: regressed!.regressionObservedAt,
          report,
        },
        null,
        2,
      ),
    )
  })

  it('cross-references outcome ledger for PR when fix-flow is absent', () => {
    const md = `
## 1. Topic 13 · \`auto-add-canonical\` · example page

| Field | Value |
|-------|-------|
| Origin | \`https://example.com\` |
| Topic | 13 |
| Verdict | \`auto-add-canonical\` |
| Page | \`https://example.com/page\` |
| Fixed | 2026-09-22T06:41:58Z |
| PR | [kamrangul87/autodun-ai#99](https://github.com/kamrangul87/autodun-ai/pull/99) — merge \`abc\` |
| Outcome | **closed** |
`
    const pr = lookupOutcomeLedgerPr({
      topicId: '13',
      verdict: 'auto-add-canonical',
      pageUrl: 'https://example.com/page',
      markdown: md,
    })
    expect(pr?.prNumber).toBe(99)
    expect(pr?.prUrl).toBe('https://github.com/kamrangul87/autodun-ai/pull/99')
    expect(pr?.source).toBe('outcome_ledger')

    const report = buildRegressionReport(
      {
        id: 'f-ledger',
        status: 'regressed',
        topicId: '13',
        verdict: 'auto-add-canonical',
        pageUrl: 'https://example.com/page',
        resolvedAt: '2026-09-22T07:00:00.000Z',
        fixedAt: '2026-09-22T06:41:58.000Z',
        postFixStatus: 'regressed',
        regressionObservedAt: '2026-09-28T00:00:00.000Z',
      },
      { outcomeMarkdown: md },
    )
    expect(report.fixPr?.prNumber).toBe(99)
    expect(report.detail).toMatch(/PR #99/)
  })
})

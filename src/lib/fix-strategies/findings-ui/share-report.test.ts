import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createMemoryFindingsStore,
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
} from './crawl/index'
import type { RolledPersistCandidate } from './crawl/run-detectors'
import {
  buildShareableReport,
  parseOutcomeLedger,
  renderReportText,
} from './share-report'
import { BANNED_CLAIM_WORDS_RE } from '@/lib/copy-rules'

function makeFinding(
  overrides: Partial<RolledPersistCandidate> = {},
): RolledPersistCandidate {
  return {
    topicId: '49',
    kind: 'performance/img-missing-dimensions',
    verdict: 'auto-set-dimensions',
    severity: 'high',
    detail: 'missing width/height',
    pageUrl: 'https://example.com/page',
    declarationSite: null,
    rollupKey: '49|auto-set-dimensions|https://example.com/page',
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

const FIXTURE_LEDGER = `# Fix -> verify -> outcome record

## 1. Topic 49 · \`auto-set-dimensions\` · example page

| Field | Value |
|-------|-------|
| Origin | \`https://example.com\` |
| Topic | 49 |
| Verdict | \`auto-set-dimensions\` |
| Page | \`https://example.com/page\` |
| Fixed | 2026-09-22T06:41:58Z |
| PR | [org/repo#34](https://github.com/org/repo/pull/34) — merge \`9ad64e0\` |
| Production verify | **OK** — 2026-09-22T06:44Z |
| Outcome | **closed** — production postcondition holds |

---

## 2. Topic 34 · \`human-review-missing-lang\` · guard, no fix

| Field | Value |
|-------|-------|
| Origin | \`https://example.com\` |
| Page | \`https://example.com/other\` |
| Action | **No site change** — left alone per owner |
| Outcome | **excluded** — not a content fix |

---

### 3. \`finding-wrong-ratio\` · sub-heading style entry

| Field | Value |
|-------|-------|
| Page | \`https://example.com/third\` |
| PR | [org/repo#36](https://github.com/org/repo/pull/36) — merge \`b679e9b\` |
| Production verify | **OK** — 2026-09-22T08:00Z |
| Outcome | **closed** |
`

describe('parseOutcomeLedger', () => {
  it('parses a PR-bearing entry with page, PR url/number, merge sha, and verify status', () => {
    const entries = parseOutcomeLedger(FIXTURE_LEDGER)
    const first = entries.find((e) => e.page === 'https://example.com/page')
    expect(first).toBeTruthy()
    expect(first!.prUrl).toBe('https://github.com/org/repo/pull/34')
    expect(first!.prNumber).toBe(34)
    expect(first!.mergeSha).toBe('9ad64e0')
    expect(first!.productionVerifyOk).toBe(true)
    expect(first!.outcome).toMatch(/closed/)
  })

  it('skips a no-PR entry (guard / excluded, not a real fix)', () => {
    const entries = parseOutcomeLedger(FIXTURE_LEDGER)
    expect(entries.some((e) => e.page === 'https://example.com/other')).toBe(false)
  })

  it('parses a "### N." sub-heading entry the same as a "## N." one', () => {
    const entries = parseOutcomeLedger(FIXTURE_LEDGER)
    const third = entries.find((e) => e.page === 'https://example.com/third')
    expect(third).toBeTruthy()
    expect(third!.prNumber).toBe(36)
  })

  it('returns an empty array for empty/missing markdown', () => {
    expect(parseOutcomeLedger('')).toEqual([])
  })
})

describe('buildShareableReport', () => {
  let ledgerRoot: string

  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
    ledgerRoot = mkdtempSync(join(tmpdir(), 'share-report-test-'))
    mkdirSync(join(ledgerRoot, 'docs/fix-strategies'), { recursive: true })
    writeFileSync(
      join(ledgerRoot, 'docs/fix-strategies/FIX_VERIFY_OUTCOME_RECORD.md'),
      FIXTURE_LEDGER,
    )
  })

  afterEach(() => {
    rmSync(ledgerRoot, { recursive: true, force: true })
  })

  it('lists findings currently in fix_strategies_findings under detected', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 'site-a',
      userId: 'user-a',
      origin: 'https://example.com',
    })
    await store.upsertFindings({
      siteId: 'site-a',
      userId: 'user-a',
      runId: run.id,
      findings: [makeFinding()],
      internalEvidence: [],
    })

    const report = await buildShareableReport({
      siteId: 'site-a',
      origin: 'https://example.com',
      store,
      repoRoot: ledgerRoot,
    })
    expect(report.detected.length).toBe(1)
    expect(report.detected[0]!.finding.pageUrl).toBe('https://example.com/page')
  })

  it('lists a ledger-recorded fix under fixesApplied even with zero matching rows in fix_strategies_findings — the real autodun shape (verified-closed fixes are not still-open rows)', async () => {
    const store = createMemoryFindingsStore() // deliberately never seeded — matches production autodun today
    const report = await buildShareableReport({
      siteId: 'site-empty',
      origin: 'https://example.com',
      store,
      repoRoot: ledgerRoot,
    })
    expect(report.detected.length).toBe(0)
    expect(report.fixesApplied.length).toBe(2) // the fixture's two PR-bearing, example.com-origin entries
    const first = report.fixesApplied.find((f) => f.page === 'https://example.com/page')
    expect(first).toBeTruthy()
    expect(first!.ledger.prUrl).toBe('https://github.com/org/repo/pull/34')
    expect(first!.plainEnglish).toBeTruthy()
    expect(first!.plainEnglish).not.toMatch(BANNED_CLAIM_WORDS_RE)
  })

  it('excludes the ledger\'s no-PR (guard/excluded) entry from fixesApplied', async () => {
    const store = createMemoryFindingsStore()
    const report = await buildShareableReport({
      siteId: 'site-empty',
      origin: 'https://example.com',
      store,
      repoRoot: ledgerRoot,
    })
    expect(report.fixesApplied.some((f) => f.page === 'https://example.com/other')).toBe(false)
  })

  it('separates resolved from regressed, and both from still-open findings', async () => {
    const store = createMemoryFindingsStore()
    const run1 = await store.createRun({ siteId: 'site-b', userId: 'user-a', origin: 'https://example.com' })
    await store.upsertFindings({
      siteId: 'site-b', userId: 'user-a', runId: run1.id,
      findings: [makeFinding()], internalEvidence: [],
    })
    const run2 = await store.createRun({ siteId: 'site-b', userId: 'user-a', origin: 'https://example.com' })
    await store.upsertFindings({ siteId: 'site-b', userId: 'user-a', runId: run2.id, findings: [], internalEvidence: [] })
    await store.resolveAbsentFindings({
      siteId: 'site-b', userId: 'user-a', runId: run2.id,
      assessedPageUrls: ['https://example.com/page'], fullCoverage: true,
    })

    const report = await buildShareableReport({ siteId: 'site-b', origin: 'https://example.com', store, repoRoot: ledgerRoot })
    expect(report.resolved.length).toBe(1)
    expect(report.regressed.length).toBe(0)
  })

  it('lists a human-review finding with no ledger entry under notFixed, with its reason', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({ siteId: 'site-c', userId: 'user-a', origin: 'https://example.com' })
    await store.upsertFindings({
      siteId: 'site-c', userId: 'user-a', runId: run.id,
      findings: [
        makeFinding({
          verdict: 'human-review-blast-radius',
          surfaceClass: 'human-review',
          autoFixable: false,
          pageUrl: 'https://example.com/needs-review',
        }),
      ],
      internalEvidence: [],
    })

    const report = await buildShareableReport({ siteId: 'site-c', origin: 'https://example.com', store, repoRoot: ledgerRoot })
    expect(report.notFixed.length).toBe(1)
    expect(report.notFixed[0]!.finding.whyNotAutoFixed).toBeTruthy()
  })
})

describe('renderReportText', () => {
  it('produces banned-word-free, section-labelled plain text', async () => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
    const store = createMemoryFindingsStore()
    const run = await store.createRun({ siteId: 'site-d', userId: 'user-a', origin: 'https://example.com' })
    await store.upsertFindings({
      siteId: 'site-d', userId: 'user-a', runId: run.id,
      findings: [makeFinding()], internalEvidence: [],
    })
    const report = await buildShareableReport({ siteId: 'site-d', origin: 'https://example.com', store })
    const text = renderReportText(report)

    expect(text).toMatch(/Findings detected/)
    expect(text).toMatch(/Fixes applied/)
    expect(text).toMatch(/Resolved/)
    expect(text).toMatch(/Regressed/)
    expect(text).toMatch(/Deliberately not fixed/)
    expect(text).not.toMatch(BANNED_CLAIM_WORDS_RE)
  })
})

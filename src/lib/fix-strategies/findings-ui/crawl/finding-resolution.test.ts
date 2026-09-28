import { describe, expect, it, beforeEach } from 'vitest'
import {
  createMemoryFindingsStore,
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

describe('finding resolution lifecycle', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
  })

  it('a new finding starts open, with no resolvedAt', async () => {
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
    const [row] = await store.listFindings({ siteId: 'site-a', includeInformational: false })
    expect(row!.status).toBe('open')
    expect(row!.resolvedAt).toBeNull()
  })

  it('partial run does not resolve findings for URLs it never crawled', async () => {
    const store = createMemoryFindingsStore()
    const run1 = await store.createRun({ siteId: 'site-a', userId: 'user-a', origin: 'https://example.com' })
    await store.upsertFindings({
      siteId: 'site-a', userId: 'user-a', runId: run1.id,
      findings: [
        makeFinding({ pageUrl: 'https://example.com/page', rollupKey: '13|auto-add-canonical|https://example.com/page' }),
        makeFinding({
          pageUrl: 'https://example.com/other',
          rollupKey: '13|auto-add-canonical|https://example.com/other',
        }),
      ],
      internalEvidence: [],
    })

    const run2 = await store.createRun({ siteId: 'site-a', userId: 'user-a', origin: 'https://example.com' })
    await store.upsertFindings({
      siteId: 'site-a', userId: 'user-a', runId: run2.id,
      findings: [],
      internalEvidence: [],
    })
    // Partial: only /page was assessed — /other must stay open.
    const { resolvedCount } = await store.resolveAbsentFindings({
      siteId: 'site-a',
      userId: 'user-a',
      runId: run2.id,
      assessedPageUrls: ['https://example.com/page'],
      fullCoverage: false,
    })
    expect(resolvedCount).toBe(1)

    const rows = await store.listFindings({ siteId: 'site-a', includeInformational: false })
    const byUrl = Object.fromEntries(rows.map((r) => [r.pageUrl, r.status]))
    expect(byUrl['https://example.com/page']).toBe('resolved')
    expect(byUrl['https://example.com/other']).toBe('open')
  })

  it('resolves a finding absent from a later complete run for an assessed URL', async () => {
    const store = createMemoryFindingsStore()
    const run1 = await store.createRun({ siteId: 'site-a', userId: 'user-a', origin: 'https://example.com' })
    await store.upsertFindings({
      siteId: 'site-a', userId: 'user-a', runId: run1.id,
      findings: [makeFinding()], internalEvidence: [],
    })

    const run2 = await store.createRun({ siteId: 'site-a', userId: 'user-a', origin: 'https://example.com' })
    await store.upsertFindings({
      siteId: 'site-a', userId: 'user-a', runId: run2.id,
      findings: [], internalEvidence: [],
    })
    const { resolvedCount } = await store.resolveAbsentFindings({
      siteId: 'site-a',
      userId: 'user-a',
      runId: run2.id,
      assessedPageUrls: ['https://example.com/page'],
      fullCoverage: true,
    })
    expect(resolvedCount).toBe(1)

    const [row] = await store.listFindings({ siteId: 'site-a', includeInformational: false })
    expect(row!.status).toBe('resolved')
    expect(row!.resolvedAt).not.toBeNull()
  })

  it('flags a resolved finding as regressed when it reappears, and keeps resolvedAt', async () => {
    const store = createMemoryFindingsStore()
    const run1 = await store.createRun({ siteId: 'site-a', userId: 'user-a', origin: 'https://example.com' })
    await store.upsertFindings({
      siteId: 'site-a', userId: 'user-a', runId: run1.id,
      findings: [makeFinding()], internalEvidence: [],
    })

    const run2 = await store.createRun({ siteId: 'site-a', userId: 'user-a', origin: 'https://example.com' })
    await store.upsertFindings({
      siteId: 'site-a', userId: 'user-a', runId: run2.id,
      findings: [], internalEvidence: [],
    })
    await store.resolveAbsentFindings({
      siteId: 'site-a',
      userId: 'user-a',
      runId: run2.id,
      assessedPageUrls: ['https://example.com/page'],
      fullCoverage: true,
    })

    const [resolved] = await store.listFindings({ siteId: 'site-a', includeInformational: false })
    const resolvedAt = resolved!.resolvedAt
    expect(resolved!.status).toBe('resolved')

    const run3 = await store.createRun({ siteId: 'site-a', userId: 'user-a', origin: 'https://example.com' })
    await store.upsertFindings({
      siteId: 'site-a', userId: 'user-a', runId: run3.id,
      findings: [makeFinding()], internalEvidence: [],
    })

    const [regressed] = await store.listFindings({ siteId: 'site-a', includeInformational: false })
    expect(regressed!.status).toBe('regressed')
    expect(regressed!.resolvedAt).toBe(resolvedAt)
    expect(regressed!.id).toBe(resolved!.id)
  })

  it('never touches internal-bucket rows or a scope it was not asked about', async () => {
    const store = createMemoryFindingsStore()
    const runA = await store.createRun({ siteId: 'site-a', userId: 'user-a', origin: 'https://example.com' })
    await store.upsertFindings({
      siteId: 'site-a', userId: 'user-a', runId: runA.id,
      findings: [makeFinding()],
      internalEvidence: [
        {
          topicId: '13', kind: 'x', verdict: 'suppress-unknown-type', severity: null,
          detail: 'suppressed', pageUrl: 'https://example.com/page', declarationSite: null,
          autoFixable: false, proposedDiff: null, evidenceValues: null, bucket: 'internal',
        },
      ],
    })

    const runB = await store.createRun({ siteId: 'site-b', userId: 'user-b', origin: 'https://other.example.com' })
    await store.upsertFindings({
      siteId: 'site-b', userId: 'user-b', runId: runB.id,
      findings: [makeFinding({ pageUrl: 'https://other.example.com/x', rollupKey: '13|auto-add-canonical|https://other.example.com/x' })],
      internalEvidence: [],
    })

    const runA2 = await store.createRun({ siteId: 'site-a', userId: 'user-a', origin: 'https://example.com' })
    await store.upsertFindings({ siteId: 'site-a', userId: 'user-a', runId: runA2.id, findings: [], internalEvidence: [] })
    const { resolvedCount } = await store.resolveAbsentFindings({
      siteId: 'site-a',
      userId: 'user-a',
      runId: runA2.id,
      assessedPageUrls: ['https://example.com/page'],
      fullCoverage: true,
    })
    expect(resolvedCount).toBe(1)

    const [siteBRow] = await store.listFindings({ siteId: 'site-b', includeInformational: false })
    expect(siteBRow!.status).toBe('open')
  })
})

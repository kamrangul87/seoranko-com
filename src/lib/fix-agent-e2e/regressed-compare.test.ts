/**
 * Regression: after a fix is verified then the seed defect reappears, the
 * finding becomes `regressed` and must count in crawl_compare and fix-run
 * selection exactly like `open`.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  createMemoryFindingsStore,
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
} from '@/lib/fix-strategies/findings-ui/crawl'
import type { RolledPersistCandidate } from '@/lib/fix-strategies/findings-ui/crawl/run-detectors'
import { isCurrentlyPresentFindingStatus } from '@/lib/fix-strategies/findings-ui/finding-status'
import { selectAutoFixableFindings } from '@/lib/fix-strategies/findings-ui/fix-run/start'
import { compareFindingsExact } from './compare'

vi.mock('@/lib/fix-strategies/findings-ui/fix-run/apply-registry', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/fix-strategies/findings-ui/fix-run/apply-registry')
  >('@/lib/fix-strategies/findings-ui/fix-run/apply-registry')
  return {
    ...actual,
    isTransformRegistered: () => true,
    isCommitableFinding: (f: {
      autoFixable?: boolean
      postFixStatus?: string | null
      sourcePath?: string | null
      sourceBlobSha?: string | null
    }) =>
      Boolean(
        f.autoFixable &&
          f.postFixStatus !== 'verified' &&
          f.sourcePath &&
          f.sourceBlobSha,
      ),
  }
})

vi.mock('@/lib/fix-strategies/findings-ui/fix-run/failure-learning', () => ({
  fixTypeKey: (t: string, v: string) => `${t}|${v}`,
  loadPausedFixTypeSet: async () => new Set<string>(),
}))

function makeFinding(
  overrides: Partial<RolledPersistCandidate> = {},
): RolledPersistCandidate {
  return {
    topicId: '14',
    kind: 'canonical/broken-target',
    verdict: 'auto-self-canonical',
    severity: 'high',
    detail: 'broken canonical',
    pageUrl: 'https://seoranko-fixture.vercel.app/about.html',
    declarationSite: null,
    rollupKey:
      '14|auto-self-canonical|https://seoranko-fixture.vercel.app/about.html',
    affectedUrlCount: 1,
    rolledUp: false,
    bucket: 'actionable',
    autoFixable: true,
    reportOnly: false,
    surfaceClass: 'auto-fixable',
    proposedDiff: null,
    evidenceValues: null,
    sourceRows: [],
    ...overrides,
  }
}

/** Mirror crawl_compare's currently-detected filter. */
function currentlyDetectedFromCrawl(
  rows: Awaited<
    ReturnType<ReturnType<typeof createMemoryFindingsStore>['listFindings']>
  >,
  crawlId: string,
) {
  return rows
    .filter(
      (f) =>
        isCurrentlyPresentFindingStatus(f.status) &&
        f.lastSeenRunId === crawlId,
    )
    .map((f) => ({
      topicId: f.topicId,
      verdict: f.verdict,
      pageUrl: f.pageUrl,
      surfaceClass: f.surfaceClass,
      autoFixable: f.autoFixable && f.surfaceClass === 'auto-fixable',
      bucket: f.bucket,
    }))
}

describe('regressed findings in compare + fix run', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
  })

  it('fixed → reappears → regressed is included in compare and fix-run selection', async () => {
    const store = createMemoryFindingsStore()
    const siteId = 'f19c49c9-31d9-4b4d-b898-c63dd8d98f6c'

    const run1 = await store.createRun({
      siteId,
      userId: 'u',
      origin: 'https://seoranko-fixture.vercel.app',
    })
    await store.upsertFindings({
      siteId,
      userId: 'u',
      runId: run1.id,
      findings: [makeFinding()],
      internalEvidence: [],
    })

    const run2 = await store.createRun({
      siteId,
      userId: 'u',
      origin: 'https://seoranko-fixture.vercel.app',
    })
    await store.upsertFindings({
      siteId,
      userId: 'u',
      runId: run2.id,
      findings: [],
      internalEvidence: [],
    })
    await store.resolveAbsentFindings({
      siteId,
      userId: 'u',
      runId: run2.id,
      assessedPageUrls: ['https://seoranko-fixture.vercel.app/about.html'],
      fullCoverage: true,
    })
    const [resolved] = await store.listFindings({ siteId })
    expect(resolved!.status).toBe('resolved')
    // Simulate SEORANKO verified fix (memory store returns live row refs).
    resolved!.postFixStatus = 'verified'
    resolved!.fixedAt = new Date().toISOString()

    await new Promise((r) => setTimeout(r, 5))
    const run3 = await store.createRun({
      siteId,
      userId: 'u',
      origin: 'https://seoranko-fixture.vercel.app',
    })
    await store.upsertFindings({
      siteId,
      userId: 'u',
      runId: run3.id,
      findings: [makeFinding()],
      internalEvidence: [],
    })
    const after = await store.listFindings({ siteId })
    expect(after).toHaveLength(1)
    expect(after[0]!.status).toBe('regressed')
    expect(after[0]!.postFixStatus).toBe('regressed')
    expect(isCurrentlyPresentFindingStatus(after[0]!.status)).toBe(true)

    const observed = currentlyDetectedFromCrawl(after, run3.id)
    expect(observed).toHaveLength(1)
    expect(
      compareFindingsExact(observed, [
        {
          topicId: '14',
          verdict: 'auto-self-canonical',
          pageUrl: 'https://seoranko-fixture.vercel.app/about.html',
          surfaceClass: 'auto-fixable',
          autoFixable: true,
          bucket: 'actionable',
        },
      ]),
    ).toEqual({ ok: true })

    await store.updateFindingSourceResolution({
      findingId: after[0]!.id,
      sourcePath: 'about.html',
      sourceBlobSha: 'sha-about-2',
      sourceResolvedAt: new Date().toISOString(),
      sourceUnresolvedReason: null,
      autoFixable: true,
      surfaceClass: 'auto-fixable',
    })

    const selected = await selectAutoFixableFindings(siteId)
    expect(selected.map((f) => f.id)).toContain(after[0]!.id)
    expect(
      selected.every((f) => isCurrentlyPresentFindingStatus(f.status)),
    ).toBe(true)
  })
})

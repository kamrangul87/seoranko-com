import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
  createMemoryFindingsStore,
} from '../crawl/store'
import {
  resetMemoryFixRunStore,
  useMemoryFixRunStore,
  getFixRunStore,
} from './store'
import { tickFixRun, type TickDeps } from './tick'

function minutesAgo(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString()
}

describe('verify_production_next fallback without GitHub creds', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
    resetMemoryFixRunStore()
    useMemoryFixRunStore()
  })

  it('assumes production ready after timeout and verifies live', async () => {
    // Seed one auto-fixable finding with a resolved source.
    const findings = createMemoryFindingsStore()
    const crawl = await findings.createRun({
      siteId: 'site-fallback',
      userId: 'user-fallback',
      origin: 'https://fixture.example',
    })
    await findings.upsertFindings({
      siteId: 'site-fallback',
      userId: 'user-fallback',
      runId: crawl.id,
      findings: [
        {
          topicId: 'fixture',
          kind: 'fixture/patch',
          verdict: 'auto-fixture-patch',
          severity: 'moderate',
          detail: `fixture defect a.html`,
          pageUrl: `https://fixture.example/a.html`,
          declarationSite: null,
          rollupKey: `fixture|auto-fixture-patch|https://fixture.example/a.html`,
          affectedUrlCount: 1,
          rolledUp: false,
          bucket: 'actionable',
          autoFixable: true,
          reportOnly: false,
          surfaceClass: 'auto-fixable',
          proposedDiff: null,
          evidenceValues: { resolveNeedle: '<body' },
          sourceRows: [],
        },
      ],
      internalEvidence: [],
    })
    const rows = await findings.listFindings({
      siteId: 'site-fallback',
      includeInformational: false,
    })
    const finding = rows[0]!
    await findings.updateFindingSourceResolution({
      findingId: finding.id,
      sourcePath: 'public/a.html',
      sourceBlobSha: 'sha-a',
      sourceResolvedAt: new Date().toISOString(),
      sourceUnresolvedReason: null,
      autoFixable: true,
      surfaceClass: 'auto-fixable',
    })

    // Create a run and mark the item committed with a path + commitSha.
    const store = getFixRunStore()
    const created = await store.createRun({
      userId: 'user-fallback',
      siteId: 'site-fallback',
      findingIds: [finding.id],
      branchName: 'seoranko/test-fallback',
    })
    const run = await store.getRun(created.id, 'user-fallback')
    if (!run) throw new Error('missing run')
    const item = run.items[0]!
    item.status = 'committed'
    item.commitSha = 'deadbeef'
    item.path = 'public/a.html'
    run.items = [item]
    run.mergeSha = 'cafebabe'
    run.prNumber = 123
    // Simulate customer-merged long ago; resume at production verify.
    run.mergedByCustomer = true
    run.mergedAt = minutesAgo(20) // > 15 min fallback
    run.phase = 'verify_production_next'
    run.status = 'running'
    await store.saveRun(run, { caller: 'test:seed_committed' })

    // Deps without GitHub deploy readiness; fetchPage returns production body
    // that includes the fixture marker so verification passes.
    const deps: TickDeps = {
      // No GitHub ops other than a pending wait (simulating 401/403).
      ops: {
        async waitForProductionDeploy() {
          return { ok: false as const, pending: true as const, error: 'no-creds' }
        },
      } as unknown as TickDeps['ops'],
      creds: { owner: '', repo: '', baseBranch: 'main', accessToken: '' },
      siteOrigin: 'https://fixture.example',
      fetchPage: async (url: string) => {
        const pathMatch = url.match(/\/a\.html/)
        const ok = !!pathMatch
        const body = ok ? '<html><body><!-- data-seoranko-fix="marker" --></body></html>' : ''
        return { ok, status: ok ? 200 : 404, body }
      },
      startRecrawl: async () => {},
    }

    // First tick should assume production READY by timeout and verify the item.
    const first = await tickFixRun({
      runId: run.id,
      userId: 'user-fallback',
      deps,
    })
    expect(first.advanced).toBe(true)
    expect(first.run.items[0]?.status).toBe('verified_live')
    // Next tick should advance to recrawl/done.
    const second = await tickFixRun({
      runId: run.id,
      userId: 'user-fallback',
      deps,
    })
    expect(['recrawl', 'done']).toContain(second.run.phase)
  })
})


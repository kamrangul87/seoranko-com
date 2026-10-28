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
import { startFixRun } from './start'
import { tickFixRun, type TickDeps } from './tick'
import { createFixtureGithubRepo, FIXTURE_CREDS } from './fixture-github'

function makeDeps(repo: ReturnType<typeof createFixtureGithubRepo>): TickDeps {
  return {
    ops: repo.ops,
    creds: FIXTURE_CREDS,
    siteOrigin: 'https://fixture.example',
    fetchPage: async (url) => {
      const pathMatch = url.match(/\/a\.html/)
      const file = pathMatch ? 'public/a.html' : null
      if (!file) return { ok: false, body: '', status: 404 }
      // Preview host marker
      const isPreview =
        url.includes('fix-run-preview.test') ||
        /fix-run-preview-[a-z0-9]+\.vercel\.app/i.test(url)
      if (isPreview) {
        const body =
          repo.previewContent.get(file) ||
          repo.branches.get([...repo.branches.keys()][0] || '')?.get(file) ||
          ''
        return { ok: !!body, body, status: body ? 200 : 404 }
      }
      const body =
        repo.productionContent.get(file) || repo.production.get(file) || ''
      return { ok: !!body, body, status: body ? 200 : 404 }
    },
    startRecrawl: async () => {},
  }
}

async function seedOneFinding() {
  const store = createMemoryFindingsStore()
  const crawl = await store.createRun({
    siteId: 'site-recover',
    userId: 'user-recover',
    origin: 'https://fixture.example',
  })
  await store.upsertFindings({
    siteId: 'site-recover',
    userId: 'user-recover',
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
  const rows = await store.listFindings({
    siteId: 'site-recover',
    includeInformational: false,
  })
  await store.updateFindingSourceResolution({
    findingId: rows[0]!.id,
    sourcePath: 'public/a.html',
    sourceBlobSha: 'sha-a',
    sourceResolvedAt: new Date().toISOString(),
    sourceUnresolvedReason: null,
    autoFixable: true,
    surfaceClass: 'auto-fixable',
  })
}

describe('recover receipt for customer-merged failed run', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
    resetMemoryFixRunStore()
    useMemoryFixRunStore()
  })

  it('verifies committed items against production after recovery', async () => {
    await seedOneFinding()
    const repo = createFixtureGithubRepo({
      'public/a.html': '<html><body>A</body></html>',
    })
    const started = await startFixRun({
      userId: 'user-recover',
      siteId: 'site-recover',
      siteDomain: 'fixture.example',
      githubConnected: true,
    })
    if (!started.ok) throw new Error('start failed')
    const deps = makeDeps(repo)

    // Drain up to PR open (ensure_pr done → wait_preview), ensuring item is committed.
    let state = await tickFixRun({
      runId: started.run.id,
      userId: 'user-recover',
      deps,
    })
    for (let i = 0; i < 10 && state.run.phase !== 'wait_preview'; i++) {
      state = await tickFixRun({
        runId: started.run.id,
        userId: 'user-recover',
        deps,
      })
    }
    expect(state.run.prNumber).toBeTruthy()
    // Simulate an older build that marked the run terminal failed.
    const store = getFixRunStore()
    const stale = await store.getRun(state.run.id, 'user-recover')
    if (!stale) throw new Error('missing run')
    stale.phase = 'done'
    stale.status = 'failed'
    stale.errorDetail = 'legacy failure before merged-by-customer handling'
    await store.saveRun(stale, { caller: 'test:legacy_fail' })

    // Customer merges the PR manually.
    await repo.ops.mergePullRequest!({
      creds: FIXTURE_CREDS,
      prNumber: state.run.prNumber!,
    })
    const pr = await repo.ops.getPullRequest!({
      creds: FIXTURE_CREDS,
      prNumber: state.run.prNumber!,
    })
    expect(pr.ok && pr.merged).toBe(true)

    // Recovery: mark mergedByCustomer and resume at production verify.
    const recovering = await store.getRun(state.run.id, 'user-recover')
    if (!recovering) throw new Error('missing run (recover)')
    recovering.mergedByCustomer = true
    recovering.mergedAt = pr.ok ? pr.mergedAt || new Date().toISOString() : null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recovering.mergeSha = (pr as any).mergedSha || recovering.mergeSha
    recovering.phase = 'verify_production_next'
    recovering.status = 'running'
    recovering.errorDetail = null
    await store.saveRun(recovering, { caller: 'test:recover' })

    // Drain verification until done.
    let last = await tickFixRun({
      runId: recovering.id,
      userId: 'user-recover',
      deps,
    })
    for (let i = 0; i < 40 && last.run.phase !== 'done'; i++) {
      last = await tickFixRun({
        runId: recovering.id,
        userId: 'user-recover',
        deps,
      })
    }
    expect(last.run.phase).toBe('done')
    expect(last.run.status).toBe('complete')
    expect(last.run.items.every((i) => i.status === 'verified_live')).toBe(true)
  })
})


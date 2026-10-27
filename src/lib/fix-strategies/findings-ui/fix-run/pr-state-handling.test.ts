import { describe, expect, it, beforeEach } from 'vitest'
import {
  resetMemoryFixRunStore,
  useMemoryFixRunStore,
} from './store'
import {
  createMemoryFindingsStore,
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
} from '../crawl/store'
import { startFixRun } from './start'
import { tickFixRun, type TickDeps } from './tick'
import { createFixtureGithubRepo, FIXTURE_CREDS } from './fixture-github'

function finding(page: string) {
  return {
    topicId: 'fixture',
    kind: 'fixture/patch',
    verdict: 'auto-fixture-patch',
    severity: 'moderate',
    detail: `fixture defect ${page}`,
    pageUrl: `https://fixture.example/${page}`,
    declarationSite: null,
    rollupKey: `fixture|auto-fixture-patch|https://fixture.example/${page}`,
    affectedUrlCount: 1,
    rolledUp: false,
    bucket: 'actionable',
    autoFixable: true,
    reportOnly: false,
    surfaceClass: 'auto-fixable',
    proposedDiff: null,
    evidenceValues: { resolveNeedle: '<body' },
    sourceRows: [],
  }
}

async function seed() {
  const store = createMemoryFindingsStore()
  const crawl = await store.createRun({
    siteId: 'site-pr',
    userId: 'user-pr',
    origin: 'https://fixture.example',
  })
  await store.upsertFindings({
    siteId: 'site-pr',
    userId: 'user-pr',
    runId: crawl.id,
    findings: [finding('a.html')],
    internalEvidence: [],
  })
  const rows = await store.listFindings({
    siteId: 'site-pr',
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

function depsFor(repo: ReturnType<typeof createFixtureGithubRepo>): TickDeps {
  return {
    ops: repo.ops,
    creds: FIXTURE_CREDS,
    siteOrigin: 'https://fixture.example',
    fetchPage: async (url) => {
      const path = 'public/a.html'
      const isPreview =
        url.includes('fix-run-preview.test') ||
        /fix-run-preview-[a-z0-9]+\.vercel\.app/i.test(url)
      if (isPreview) {
        const body =
          repo.previewContent.get(path) ||
          repo.branches.get([...repo.branches.keys()][0] || '')?.get(path) ||
          ''
        return { ok: !!body, body, status: body ? 200 : 404 }
      }
      const body =
        repo.productionContent.get(path) || repo.production.get(path) || ''
      return { ok: !!body, body, status: body ? 200 : 404 }
    },
  }
}

describe('PR state handling (manual merge/close)', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
    resetMemoryFixRunStore()
    useMemoryFixRunStore()
  })

  it('merged during wait_preview → skip preview and proceed to production verify', async () => {
    await seed()
    const repo = createFixtureGithubRepo({
      'public/a.html': '<html><body>A</body></html>',
    })
    const started = await startFixRun({
      userId: 'user-pr',
      siteId: 'site-pr',
      siteDomain: 'fixture.example',
      githubConnected: true,
    })
    if (!started.ok) throw new Error('start failed')
    const deps = depsFor(repo)
    // Drain until PR open (ensure_pr done → wait_preview)
    let t = await tickFixRun({ runId: started.run.id, userId: 'user-pr', deps }) // create_branch → apply
    for (let i = 0; i < 5; i++) {
      t = await tickFixRun({ runId: started.run.id, userId: 'user-pr', deps })
      if (t.run.phase === 'wait_preview') break
    }
    expect(t.run.phase).toBe('wait_preview')
    // Simulate customer merge
    await repo.ops.mergePullRequest!({ creds: FIXTURE_CREDS, prNumber: t.run.prNumber! })
    // Next tick should jump to production verify
    t = await tickFixRun({ runId: started.run.id, userId: 'user-pr', deps })
    expect(t.run.phase === 'verify_production_next' || t.run.phase === 'recrawl' || t.run.phase === 'done').toBe(true)
    expect(Boolean(t.run.mergeSha)).toBe(true)
    expect(Boolean(t.run.mergedByCustomer)).toBe(true)
  })

  it('merged during awaiting-approval → proceed to production verify', async () => {
    await seed()
    const repo = createFixtureGithubRepo({
      'public/a.html': '<html><body>A</body></html>',
    })
    const started = await startFixRun({
      userId: 'user-pr',
      siteId: 'site-pr',
      siteDomain: 'fixture.example',
      githubConnected: true,
    })
    if (!started.ok) throw new Error('start failed')
    const deps = depsFor(repo)
    // Drain through preview verify to await_approval
    let t = await tickFixRun({ runId: started.run.id, userId: 'user-pr', deps })
    for (let i = 0; i < 20; i++) {
      t = await tickFixRun({ runId: started.run.id, userId: 'user-pr', deps })
      if (t.run.phase === 'await_approval') break
    }
    expect(t.run.phase).toBe('await_approval')
    await repo.ops.mergePullRequest!({ creds: FIXTURE_CREDS, prNumber: t.run.prNumber! })
    t = await tickFixRun({ runId: started.run.id, userId: 'user-pr', deps })
    expect(t.run.phase === 'verify_production_next' || t.run.phase === 'recrawl' || t.run.phase === 'done').toBe(true)
    expect(Boolean(t.run.mergeSha)).toBe(true)
    expect(Boolean(t.run.mergedByCustomer)).toBe(true)
  })

  it('closed without merge → end cleanly', async () => {
    await seed()
    const repo = createFixtureGithubRepo({
      'public/a.html': '<html><body>A</body></html>',
    })
    const started = await startFixRun({
      userId: 'user-pr',
      siteId: 'site-pr',
      siteDomain: 'fixture.example',
      githubConnected: true,
    })
    if (!started.ok) throw new Error('start failed')
    const deps = depsFor(repo)
    // Drain to wait_preview
    let t = await tickFixRun({ runId: started.run.id, userId: 'user-pr', deps })
    for (let i = 0; i < 10; i++) {
      t = await tickFixRun({ runId: started.run.id, userId: 'user-pr', deps })
      if (t.run.phase === 'wait_preview') break
    }
    expect(t.run.phase).toBe('wait_preview')
    // Close PR without merge
    await repo.ops.closePullRequest!({ creds: FIXTURE_CREDS, prNumber: t.run.prNumber! })
    t = await tickFixRun({ runId: started.run.id, userId: 'user-pr', deps })
    expect(t.run.phase).toBe('done')
    expect(t.run.status).toBe('complete')
    expect(Boolean(t.run.closedByCustomer)).toBe(true)
    expect(t.run.errorDetail).toBeNull()
  })
})


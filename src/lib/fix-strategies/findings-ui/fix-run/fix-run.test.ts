/**
 * One-run Fix Agent — phase machine + fixture acceptance tests.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CUSTOMER_WRITE_GATE_USER_MESSAGE,
  requireActiveCustomerWriteGate,
} from '@/lib/customer-write-gate'
import {
  assertSinglePrInvariant,
  canMergeRun,
  allRemainingPreviewVerified,
  markItemFailed,
  markItemCommitted,
  computeSummary,
} from './phases'
import type { FixRunItem } from './types'
import {
  createMemoryFindingsStore,
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
} from '../crawl/store'
import type { RolledPersistCandidate } from '../crawl/run-detectors'
import {
  resetMemoryFixRunStore,
  useMemoryFixRunStore,
} from './store'
import { startFixRun } from './start'
import { tickFixRun, approveFixRun, type TickDeps } from './tick'
import { createFixtureGithubRepo, FIXTURE_CREDS } from './fixture-github'
import type { GithubOps } from './github-ops'

function makeItem(
  overrides: Partial<FixRunItem> & { id: string; findingId: string },
): FixRunItem {
  const now = new Date().toISOString()
  return {
    runId: 'run-1',
    position: 0,
    status: 'pending',
    commitSha: null,
    path: null,
    previewVerifiedAt: null,
    productionVerifiedAt: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function fixtureFinding(
  id: string,
  page: string,
): RolledPersistCandidate {
  return {
    topicId: 'fixture',
    kind: 'fixture/patch',
    verdict: 'auto-fixture-patch',
    severity: 'moderate',
    detail: `fixture defect ${id}`,
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

describe('fix-run write gate', () => {
  it('tick acquires findings-pr-branch gate before create_branch', async () => {
    const tickSrc = readFileSync(join(__dirname, 'tick.ts'), 'utf8')
    expect(tickSrc).toMatch(/withCustomerWriteGate/)
    expect(tickSrc).toMatch(/findings-pr-branch/)
    expect(tickSrc).toMatch(/findings-auto-merge/)
    expect(tickSrc).not.toMatch(/LEGACY_CUSTOMER_WRITES_ENABLED/)
  })

  it('create_branch via gated tick succeeds when ops require an active gate', async () => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
    resetMemoryFixRunStore()
    useMemoryFixRunStore()

    const store = createMemoryFindingsStore()
    const crawl = await store.createRun({
      siteId: 'site-gate',
      userId: 'user-fix',
      origin: 'https://fixture.example',
    })
    await store.upsertFindings({
      siteId: 'site-gate',
      userId: 'user-fix',
      runId: crawl.id,
      findings: [fixtureFinding('g', 'a.html')],
      internalEvidence: [],
    })
    const rows = await store.listFindings({
      siteId: 'site-gate',
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

    const fixture = createFixtureGithubRepo({
      'public/a.html': '<html><body>A</body></html>',
    })
    const gatedOps: GithubOps = {
      ...fixture.ops,
      async createBranch(input) {
        requireActiveCustomerWriteGate('fix-run.createBranch')
        return fixture.ops.createBranch(input)
      },
      async commitFile(input) {
        requireActiveCustomerWriteGate('fix-run.commitFile')
        return fixture.ops.commitFile(input)
      },
      async ensurePullRequest(input) {
        requireActiveCustomerWriteGate('fix-run.ensurePullRequest')
        return fixture.ops.ensurePullRequest(input)
      },
      async mergePullRequest(input) {
        requireActiveCustomerWriteGate('fix-run.mergePullRequest')
        return fixture.ops.mergePullRequest(input)
      },
    }

    // Ungated live-style call must throw (same class of failure as prod).
    await expect(
      gatedOps.createBranch({
        creds: FIXTURE_CREDS,
        branchName: 'seoranko/ungated',
      }),
    ).rejects.toThrow(/no active write gate/i)

    const started = await startFixRun({
      userId: 'user-fix',
      siteId: 'site-gate',
      siteDomain: 'fixture.example',
      githubConnected: true,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const tick = await tickFixRun({
      runId: started.run.id,
      userId: 'user-fix',
      deps: {
        ops: gatedOps,
        creds: FIXTURE_CREDS,
        siteOrigin: 'https://fixture.example',
        fetchPage: async () => ({ ok: false, body: '', status: 404 }),
      },
    })
    expect(tick.run.phase).toBe('apply_next')
    expect(tick.run.status).toBe('running')
    expect(tick.run.errorDetail).toBeNull()
    expect(tick.detail).toBe('branch created')
  })

  it('create_branch failure stores plain-language gate message, not raw internals', async () => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
    resetMemoryFixRunStore()
    useMemoryFixRunStore()

    const store = createMemoryFindingsStore()
    const crawl = await store.createRun({
      siteId: 'site-gate-fail',
      userId: 'user-fix',
      origin: 'https://fixture.example',
    })
    await store.upsertFindings({
      siteId: 'site-gate-fail',
      userId: 'user-fix',
      runId: crawl.id,
      findings: [fixtureFinding('f', 'a.html')],
      internalEvidence: [],
    })
    const rows = await store.listFindings({
      siteId: 'site-gate-fail',
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

    // Ops that throw the gate error *inside* the gated callback still map
    // to plain language when tick catches CustomerWriteGateError. Simulate by
    // throwing after the outer gate is entered — use a broken nested require
    // by calling require without inheriting (impossible with ALS nesting).
    // Instead: throw CustomerWriteGateError from createBranch itself.
    const { CustomerWriteGateError } = await import('@/lib/customer-write-gate')
    const fixture = createFixtureGithubRepo({
      'public/a.html': '<html><body>A</body></html>',
    })
    const throwingOps: GithubOps = {
      ...fixture.ops,
      async createBranch() {
        throw new CustomerWriteGateError(
          'fix-run.createBranch: customer write blocked — no active write gate',
        )
      },
    }

    const started = await startFixRun({
      userId: 'user-fix',
      siteId: 'site-gate-fail',
      siteDomain: 'fixture.example',
      githubConnected: true,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const tick = await tickFixRun({
      runId: started.run.id,
      userId: 'user-fix',
      deps: {
        ops: throwingOps,
        creds: FIXTURE_CREDS,
        siteOrigin: 'https://fixture.example',
        fetchPage: async () => ({ ok: false, body: '', status: 404 }),
      },
    })
    expect(tick.run.status).toBe('failed')
    expect(tick.run.phase).toBe('done')
    expect(tick.run.errorDetail).toBe(CUSTOMER_WRITE_GATE_USER_MESSAGE)
    expect(tick.run.errorDetail).not.toMatch(/no active write gate/i)
  })
})

describe('fix-run phase helpers', () => {
  it('enforces single-PR invariant', () => {
    expect(
      assertSinglePrInvariant({
        branchName: 'seoranko/fix-run-x',
        prNumber: 12,
        prUrl: 'https://github.com/o/r/pull/12',
      }).ok,
    ).toBe(true)
    expect(
      assertSinglePrInvariant({
        branchName: null,
        prNumber: 12,
        prUrl: 'https://github.com/o/r/pull/12',
      }).ok,
    ).toBe(false)
  })

  it('blocks merge without approval unless auto_merge gates pass', () => {
    expect(
      canMergeRun({
        approvedAt: null,
        autoMergeEnabled: false,
        autoMergeGatesPass: true,
        allPreviewVerified: true,
      }).allowed,
    ).toBe(false)

    expect(
      canMergeRun({
        approvedAt: null,
        autoMergeEnabled: true,
        autoMergeGatesPass: false,
        allPreviewVerified: true,
      }).allowed,
    ).toBe(false)

    expect(
      canMergeRun({
        approvedAt: null,
        autoMergeEnabled: true,
        autoMergeGatesPass: true,
        allPreviewVerified: true,
      }).allowed,
    ).toBe(true)

    expect(
      canMergeRun({
        approvedAt: '2026-10-06T00:00:00.000Z',
        autoMergeEnabled: false,
        autoMergeGatesPass: false,
        allPreviewVerified: true,
      }).allowed,
    ).toBe(true)
  })

  it('partial-failure isolation: one failed item does not block others', () => {
    const a = makeItem({ id: 'a', findingId: 'f1', position: 0 })
    const b = makeItem({ id: 'b', findingId: 'f2', position: 1 })
    const c = makeItem({ id: 'c', findingId: 'f3', position: 2 })
    const items = [
      markItemCommitted(a, 'sha1', 'public/a.html'),
      markItemFailed(b, 'Forced failure'),
      markItemCommitted(c, 'sha3', 'public/c.html'),
    ]
    const summary = computeSummary(items)
    expect(summary.failed).toBe(1)
    expect(summary.committed).toBe(2)
    expect(allRemainingPreviewVerified(items)).toBe(false)
    const previewed = items.map((i) =>
      i.status === 'committed'
        ? { ...i, status: 'preview_verified' as const }
        : i,
    )
    expect(allRemainingPreviewVerified(previewed)).toBe(true)
  })
})

describe('fix-run fixture acceptance (3 defects → 1 PR)', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
    resetMemoryFixRunStore()
    useMemoryFixRunStore()
  })

  async function seedThreeFindings() {
    const store = createMemoryFindingsStore()
    const crawl = await store.createRun({
      siteId: 'site-fix',
      userId: 'user-fix',
      origin: 'https://fixture.example',
    })
    await store.upsertFindings({
      siteId: 'site-fix',
      userId: 'user-fix',
      runId: crawl.id,
      findings: [
        fixtureFinding('a', 'a.html'),
        fixtureFinding('b', 'b.html'),
        fixtureFinding('c', 'c.html'),
      ],
      internalEvidence: [],
    })
    const rows = await store.listFindings({
      siteId: 'site-fix',
      includeInformational: false,
    })
    expect(rows.length).toBe(3)
    // Gate 2: stored path + blob SHA required before Fix Agent select.
    for (const row of rows) {
      const page = row.pageUrl?.split('/').pop() || 'a.html'
      await store.updateFindingSourceResolution({
        findingId: row.id,
        sourcePath: `public/${page}`,
        sourceBlobSha: `sha-${page}`,
        sourceResolvedAt: new Date().toISOString(),
        sourceUnresolvedReason: null,
        autoFixable: true,
        surfaceClass: 'auto-fixable',
      })
    }
    return store.listFindings({
      siteId: 'site-fix',
      includeInformational: false,
    })
  }

  function buildDeps(repo: ReturnType<typeof createFixtureGithubRepo>): TickDeps {
    return {
      ops: repo.ops,
      creds: FIXTURE_CREDS,
      siteOrigin: 'https://fixture.example',
      autoMergeEnabledOverride: false,
      fetchPage: async (url) => {
        // Map preview / production URLs to fixture file content
        const pathMatch = url.match(/\/(a|b|c)\.html/)
        const file = pathMatch
          ? `public/${pathMatch[1]}.html`
          : null
        if (!file) {
          return { ok: false, body: '', status: 404 }
        }
        if (url.includes('fix-run-preview.test')) {
          const body = repo.previewContent.get(file) || repo.branches.get(
            [...repo.branches.keys()][0] || '',
          )?.get(file) || ''
          return { ok: true, body, status: 200 }
        }
        const body = repo.productionContent.get(file) || repo.production.get(file) || ''
        return { ok: !!body, body, status: body ? 200 : 404 }
      },
      startRecrawl: async () => {},
    }
  }

  async function drain(runId: string, deps: TickDeps, max = 40) {
    let last = await tickFixRun({ runId, userId: 'user-fix', deps })
    for (let i = 0; i < max; i++) {
      if (
        last.run.phase === 'await_approval' ||
        last.run.phase === 'done' ||
        last.run.status === 'awaiting_approval'
      ) {
        break
      }
      last = await tickFixRun({ runId, userId: 'user-fix', deps })
    }
    return last
  }

  it('one run = one branch = one PR; each item preview-verified via re-fetch; approve → verified live', async () => {
    await seedThreeFindings()
    const repo = createFixtureGithubRepo({
      'public/a.html': '<html><body>A</body></html>',
      'public/b.html': '<html><body>B</body></html>',
      'public/c.html': '<html><body>C</body></html>',
    })

    const started = await startFixRun({
      userId: 'user-fix',
      siteId: 'site-fix',
      siteDomain: 'fixture.example',
      githubConnected: true,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const deps = buildDeps(repo)
    let state = await drain(started.run.id, deps)

    expect(state.run.prNumber).toBe(1)
    expect(state.run.prUrl).toMatch(/\/pull\/1$/)
    expect(assertSinglePrInvariant(state.run).ok).toBe(true)

    const commits = repo.commits.get(state.run.branchName!) || []
    expect(commits.length).toBe(3)
    expect(new Set(commits.map((c) => c.path)).size).toBe(3)

    expect(
      state.run.items.every((i) => i.status === 'preview_verified'),
    ).toBe(true)
    expect(state.run.canApproveMerge).toBe(true)
    expect(state.run.phase).toBe('await_approval')

    // No merge without approval
    const blocked = await tickFixRun({
      runId: started.run.id,
      userId: 'user-fix',
      deps,
    })
    expect(blocked.run.phase).toBe('await_approval')
    expect(blocked.run.mergeSha).toBeNull()

    await approveFixRun({ runId: started.run.id, userId: 'user-fix' })

    // Drain merge + production verify + recrawl
    for (let i = 0; i < 20; i++) {
      state = await tickFixRun({
        runId: started.run.id,
        userId: 'user-fix',
        deps,
      })
      if (state.run.phase === 'done') break
    }

    expect(state.run.phase).toBe('done')
    expect(state.run.status).toBe('complete')
    expect(state.run.mergeSha).toBeTruthy()
    expect(
      state.run.items.every((i) => i.status === 'verified_live'),
    ).toBe(true)
    expect(
      state.run.items.every((i) => i.productionVerifiedAt != null),
    ).toBe(true)

    // Production files contain markers
    expect(repo.production.get('public/a.html')).toMatch(/data-seoranko-fix/)
    expect(repo.production.get('public/b.html')).toMatch(/data-seoranko-fix/)
    expect(repo.production.get('public/c.html')).toMatch(/data-seoranko-fix/)

    // Pasteable run state for PR description
    console.info(
      'FIX_RUN_STATE_JSON',
      JSON.stringify(
        {
          runId: state.run.id,
          status: state.run.status,
          phase: state.run.phase,
          branchName: state.run.branchName,
          prNumber: state.run.prNumber,
          prUrl: state.run.prUrl,
          mergeSha: state.run.mergeSha,
          summary: state.run.summary,
          items: state.run.items.map((i) => ({
            findingId: i.findingId,
            status: i.status,
            commitSha: i.commitSha,
            path: i.path,
            previewVerifiedAt: i.previewVerifiedAt,
            productionVerifiedAt: i.productionVerifiedAt,
            failureReason: i.failureReason,
          })),
        },
        null,
        2,
      ),
    )
  })

  it('waits for production deploy READY before verifying any production item', async () => {
    await seedThreeFindings()
    const repo = createFixtureGithubRepo({
      'public/a.html': '<html><body>A</body></html>',
      'public/b.html': '<html><body>B</body></html>',
      'public/c.html': '<html><body>C</body></html>',
    })

    let prodPolls = 0
    const productionFetches: string[] = []
    const ops: GithubOps = {
      ...repo.ops,
      async waitForProductionDeploy() {
        prodPolls += 1
        // First poll stays pending — this is when a race would have verified
        // items 0/2 against stale production content.
        if (prodPolls < 2) {
          return {
            ok: false,
            pending: true,
            error: 'Production GitHub deployment still in progress for merge SHA',
          }
        }
        return { ok: true, detail: 'Production deployment ready (test)' }
      },
    }

    const started = await startFixRun({
      userId: 'user-fix',
      siteId: 'site-fix',
      siteDomain: 'fixture.example',
      githubConnected: true,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const deps: TickDeps = {
      ...buildDeps(repo),
      ops,
      fetchPage: async (url) => {
        if (!url.includes('fix-run-preview.test')) {
          productionFetches.push(url)
        }
        return buildDeps(repo).fetchPage(url)
      },
    }

    let state = await drain(started.run.id, deps)
    expect(state.run.phase).toBe('await_approval')
    expect(productionFetches.length).toBe(0)

    await approveFixRun({ runId: started.run.id, userId: 'user-fix' })

    // Merge tick lands on verify_production_next without fetching production yet.
    state = await tickFixRun({
      runId: started.run.id,
      userId: 'user-fix',
      deps,
    })
    for (let i = 0; i < 5 && state.run.phase !== 'verify_production_next'; i++) {
      state = await tickFixRun({
        runId: started.run.id,
        userId: 'user-fix',
        deps,
      })
    }
    expect(state.run.phase).toBe('verify_production_next')
    expect(state.run.mergeSha).toBeTruthy()

    // First production tick: deploy still pending → no item verified against stale HTML.
    state = await tickFixRun({
      runId: started.run.id,
      userId: 'user-fix',
      deps,
    })
    expect(state.run.phase).toBe('verify_production_next')
    expect(state.advanced).toBe(false)
    expect(productionFetches.length).toBe(0)
    expect(prodPolls).toBe(1)
    expect(state.run.items.every((i) => i.status !== 'verified_live')).toBe(true)

    // Second production tick: deploy READY, then first item may verify.
    state = await tickFixRun({
      runId: started.run.id,
      userId: 'user-fix',
      deps,
    })
    expect(prodPolls).toBe(2)
    expect(productionFetches.length).toBeGreaterThanOrEqual(1)
    expect(
      state.run.items.some((i) => i.status === 'verified_live') ||
        state.run.phase === 'verify_production_next',
    ).toBe(true)

    for (let i = 0; i < 20; i++) {
      state = await tickFixRun({
        runId: started.run.id,
        userId: 'user-fix',
        deps,
      })
      if (state.run.phase === 'done') break
    }
    expect(state.run.phase).toBe('done')
    expect(
      state.run.items.every((i) => i.status === 'verified_live'),
    ).toBe(true)
  })

  it('starting Fix my site while a run is active returns already_in_progress with the run', async () => {
    await seedThreeFindings()
    const first = await startFixRun({
      userId: 'user-fix',
      siteId: 'site-fix',
      siteDomain: 'fixture.example',
      githubConnected: true,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await startFixRun({
      userId: 'user-fix',
      siteId: 'site-fix',
      siteDomain: 'fixture.example',
      githubConnected: true,
    })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.code).toBe('already_in_progress')
    expect(second.error).toBe('A fix run is already in progress')
    expect(second.run?.id).toBe(first.run.id)
  })

  it('wait_preview timeout copy names the missing signal after 15 minutes', async () => {
    const tickSrc = readFileSync(join(__dirname, 'tick.ts'), 'utf8')
    expect(tickSrc).toMatch(/PREVIEW_WAIT_TIMEOUT_MS = 15 \* 60 \* 1000/)
    expect(tickSrc).toMatch(
      /No preview URL within 15 minutes — missing signal:/,
    )
  })

  it('partial failure: one transform fails, others complete, PR lacks failed change', async () => {
    await seedThreeFindings()
    const repo = createFixtureGithubRepo({
      'public/a.html': '<html><body>A</body></html>',
      'public/b.html': '<html><body>B</body></html>',
      'public/c.html': '<html><body>C</body></html>',
    })
    repo.failNextCommitForPath = 'public/b.html'

    const started = await startFixRun({
      userId: 'user-fix',
      siteId: 'site-fix',
      siteDomain: 'fixture.example',
      githubConnected: true,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const deps = buildDeps(repo)
    let state = await drain(started.run.id, deps)

    const failed = state.run.items.filter((i) => i.status === 'failed')
    const previewed = state.run.items.filter(
      (i) => i.status === 'preview_verified',
    )
    expect(failed.length).toBe(1)
    expect(failed[0]!.failureReason).toMatch(/Forced fixture failure/)
    expect(previewed.length).toBe(2)

    // Branch tip for b.html should still be original (no failed change)
    const branchFiles = repo.branches.get(state.run.branchName!)!
    expect(branchFiles.get('public/b.html')).toBe(
      '<html><body>B</body></html>',
    )
    expect(branchFiles.get('public/a.html')).toMatch(/data-seoranko-fix/)
    expect(branchFiles.get('public/c.html')).toMatch(/data-seoranko-fix/)

    await approveFixRun({ runId: started.run.id, userId: 'user-fix' })
    for (let i = 0; i < 20; i++) {
      state = await tickFixRun({
        runId: started.run.id,
        userId: 'user-fix',
        deps,
      })
      if (state.run.phase === 'done') break
    }

    expect(state.run.items.filter((i) => i.status === 'verified_live').length).toBe(
      2,
    )
    expect(state.run.items.filter((i) => i.status === 'failed').length).toBe(1)
    expect(repo.production.get('public/b.html')).toBe(
      '<html><body>B</body></html>',
    )
  })
})

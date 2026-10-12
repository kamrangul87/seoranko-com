/**
 * Regression: 7-item run applies each file exactly once and reaches preview.
 * Guards the saveRun-touch-all-items + cursor re-entry loop class.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
  createMemoryFindingsStore,
} from '../crawl/store'
import type { RolledPersistCandidate } from '../crawl/run-detectors'
import {
  resetMemoryFixRunStore,
  useMemoryFixRunStore,
  getFixRunStore,
} from './store'
import { tickFixRun, type TickDeps } from './tick'
import { createFixtureGithubRepo, FIXTURE_CREDS } from './fixture-github'
import type { GithubOps } from './github-ops'
import {
  PROGRESS_STALL_COUNT_KEY,
  PROGRESS_STALL_FP_KEY,
  recordNoProgressTick,
} from './apply-progress'

const PAGES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const

function fixtureFinding(id: string, page: string): RolledPersistCandidate {
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

describe('7-item apply → preview (exactly once each)', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
    resetMemoryFixRunStore()
    useMemoryFixRunStore()
  })

  async function seedSevenFindingIds() {
    const store = createMemoryFindingsStore()
    const crawl = await store.createRun({
      siteId: 'site-7',
      userId: 'user-fix',
      origin: 'https://fixture.example',
    })
    await store.upsertFindings({
      userId: 'user-fix',
      runId: crawl.id,
      siteId: 'site-7',
      findings: PAGES.map((p) => fixtureFinding(p, `${p}.html`)),
      internalEvidence: [],
    })
    const rows = await store.listFindings({
      siteId: 'site-7',
      includeInformational: false,
    })
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
    return rows.map((r) => r.id)
  }

  it('applies each of 7 items once and reaches await_approval with all preview_verified', async () => {
    const findingIds = await seedSevenFindingIds()
    const files: Record<string, string> = {}
    for (const p of PAGES) {
      files[`public/${p}.html`] =
        `<html><body>${p.toUpperCase()}</body></html>`
    }
    const repo = createFixtureGithubRepo(files)
    const commitCalls: string[] = []
    const wrappedOps: GithubOps = {
      ...repo.ops,
      async commitFile(input) {
        commitCalls.push(input.path)
        return repo.ops.commitFile(input)
      },
    }

    const fixStore = getFixRunStore()
    const run = await fixStore.createRun({
      userId: 'user-fix',
      siteId: 'site-7',
      findingIds,
      branchName: 'seoranko/fix-7item',
    })
    run.phase = 'apply_next'
    run.status = 'running'
    await fixStore.saveRun(run)
    await repo.ops.createBranch({
      creds: FIXTURE_CREDS,
      branchName: run.branchName!,
    })

    const deps: TickDeps = {
      ops: wrappedOps,
      creds: FIXTURE_CREDS,
      siteOrigin: 'https://fixture.example',
      autoMergeEnabledOverride: false,
      fetchPage: async (url) => {
        const pathMatch = url.match(/\/([a-g])\.html/)
        const file = pathMatch ? `public/${pathMatch[1]}.html` : null
        if (!file) return { ok: false, body: '', status: 404 }
        if (
          url.includes('fix-run-preview.test') ||
          url.includes('vercel.app')
        ) {
          const body =
            repo.previewContent.get(file) ||
            [...repo.branches.values()][0]?.get(file) ||
            ''
          return { ok: true, body, status: 200 }
        }
        const body =
          repo.productionContent.get(file) || repo.production.get(file) || ''
        return { ok: !!body, body, status: body ? 200 : 404 }
      },
      startRecrawl: async () => {},
    }

    let last = await tickFixRun({
      runId: run.id,
      userId: 'user-fix',
      deps,
    })
    for (let i = 0; i < 80; i++) {
      if (
        last.run.phase === 'await_approval' ||
        last.run.phase === 'done' ||
        last.run.status === 'awaiting_approval' ||
        last.run.status === 'failed'
      ) {
        break
      }
      last = await tickFixRun({
        runId: run.id,
        userId: 'user-fix',
        deps,
      })
    }

    expect(last.run.status).not.toBe('failed')
    expect(last.run.phase).toBe('await_approval')
    expect(last.run.items).toHaveLength(7)
    expect(last.run.items.every((i) => i.status === 'preview_verified')).toBe(
      true,
    )
    expect(last.run.itemCursor).toBeGreaterThanOrEqual(7)

    const expectedPaths = PAGES.map((p) => `public/${p}.html`)
    expect(commitCalls).toEqual(expectedPaths)
    for (const path of expectedPaths) {
      expect(commitCalls.filter((c) => c === path)).toHaveLength(1)
    }
  })

  it('persists stall counter across saveRun and fails the run on the 3rd identical apply fingerprint', async () => {
    const findingIds = await seedSevenFindingIds()
    const store = getFixRunStore()
    const run = await store.createRun({
      userId: 'user-fix',
      siteId: 'site-7',
      findingIds,
      branchName: 'seoranko/stall-test',
    })
    const fp = 'apply_next|cursor:1|applied:1'
    const prev: Record<string, string> = {}
    expect(recordNoProgressTick(prev, fp).stalled).toBe(false)
    run.phase = 'apply_next'
    run.status = 'running'
    run.itemCursor = 1
    run.prevContents = { ...prev }
    await store.saveRun(run)

    const loaded1 = await store.getRun(run.id, 'user-fix')
    expect(loaded1?.prevContents[PROGRESS_STALL_COUNT_KEY]).toBe('1')
    expect(loaded1?.prevContents[PROGRESS_STALL_FP_KEY]).toBe(fp)

    expect(recordNoProgressTick(loaded1!.prevContents, fp).stalled).toBe(false)
    await store.saveRun(loaded1!)
    const loaded2 = await store.getRun(run.id, 'user-fix')
    expect(loaded2?.prevContents[PROGRESS_STALL_COUNT_KEY]).toBe('2')

    const third = recordNoProgressTick(loaded2!.prevContents, fp)
    expect(third.stalled).toBe(true)
    loaded2!.phase = 'done'
    loaded2!.status = 'failed'
    loaded2!.errorDetail = third.stalled ? third.reason : 'stall'
    await store.saveRun(loaded2!)

    const failed = await store.getRun(run.id, 'user-fix')
    expect(failed?.status).toBe('failed')
    expect(failed?.errorDetail).toMatch(/no progress/i)
    expect(failed?.prevContents[PROGRESS_STALL_COUNT_KEY]).toBe('3')
  })
})

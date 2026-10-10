/**
 * Regression: apply_next must advance item_cursor and never re-apply committed items.
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

describe('apply_next item cursor', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
    resetMemoryFixRunStore()
    useMemoryFixRunStore()
  })

  async function seedThreeFindingIds() {
    const store = createMemoryFindingsStore()
    const crawl = await store.createRun({
      siteId: 'site-cursor',
      userId: 'user-fix',
      origin: 'https://fixture.example',
    })
    await store.upsertFindings({
      userId: 'user-fix',
      runId: crawl.id,
      siteId: 'site-cursor',
      findings: [
        fixtureFinding('a', 'a.html'),
        fixtureFinding('b', 'b.html'),
        fixtureFinding('c', 'c.html'),
      ],
      internalEvidence: [],
    })
    const rows = await store.listFindings({
      siteId: 'site-cursor',
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

  it('advances item_cursor 0→1→2→3 across ticks and never re-commits item 0', async () => {
    const findingIds = await seedThreeFindingIds()
    const fixStore = getFixRunStore()
    const run = await fixStore.createRun({
      userId: 'user-fix',
      siteId: 'site-cursor',
      findingIds,
      branchName: 'seoranko/fix-cursor-test',
    })
    run.phase = 'apply_next'
    run.status = 'running'
    await fixStore.saveRun(run)

    const repo = createFixtureGithubRepo({
      'public/a.html': '<html><body>A</body></html>',
      'public/b.html': '<html><body>B</body></html>',
      'public/c.html': '<html><body>C</body></html>',
    })
    const commitCalls: string[] = []
    await repo.ops.createBranch({
      creds: FIXTURE_CREDS,
      branchName: run.branchName!,
    })

    const wrappedOps: GithubOps = {
      ...repo.ops,
      async commitFile(input) {
        commitCalls.push(input.path)
        return repo.ops.commitFile(input)
      },
    }

    const deps: TickDeps = {
      ops: wrappedOps,
      creds: FIXTURE_CREDS,
      siteOrigin: 'https://fixture.example',
      fetchPage: async () => ({ ok: true, body: '', status: 200 }),
    }

    for (let tick = 0; tick < 3; tick++) {
      const result = await tickFixRun({
        runId: run.id,
        userId: 'user-fix',
        deps,
      })
      expect(result.advanced).toBe(true)
    }

    const final = await fixStore.getRun(run.id, 'user-fix')
    expect(final?.itemCursor).toBe(3)
    expect(final?.items.map((i) => i.status)).toEqual([
      'committed',
      'committed',
      'committed',
    ])
    expect(commitCalls).toEqual([
      'public/a.html',
      'public/b.html',
      'public/c.html',
    ])
    expect(commitCalls.filter((p) => p === 'public/a.html')).toHaveLength(1)
  })
})

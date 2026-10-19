/**
 * resolve_sources must fetch the repo tree once, cache file reads, and
 * respect a soft time budget so a tick never holds the lease for minutes.
 */
import { describe, expect, it, vi } from 'vitest'
import { createMemoryFindingsStore } from '../crawl/store'
import {
  resolveFindingSourcesForSite,
  type RepoTreeEntry,
} from './resolve-finding-sources'

vi.mock('./apply-registry', () => ({
  isTransformRegistered: (topicId: string, verdict: string) =>
    topicId === '49' && verdict === 'auto-set-dimensions',
}))

vi.mock('./failure-learning', () => ({
  recordFixFailureSafe: () => undefined,
}))

describe('resolveFindingSourcesForSite', () => {
  it('fetches the tree once and caches file reads across findings', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 'site-resolve',
      userId: 'u1',
      origin: 'https://example.com',
    })
    await store.upsertFindings({
      siteId: 'site-resolve',
      detectOrigin: null,
      userId: 'u1',
      runId: run.id,
      findings: [
        {
          topicId: '49',
          kind: 'performance/img-missing-dimensions',
          bucket: 'actionable',
          verdict: 'auto-set-dimensions',
          severity: 'moderate',
          rollupKey: '49|auto-set-dimensions|https://example.com/a',
          declarationSite: null,
          affectedUrlCount: 1,
          pageUrl: 'https://example.com/a',
          detail: 'missing width',
          autoFixable: true,
          reportOnly: false,
          surfaceClass: 'finding',
          proposedDiff: null,
          evidenceValues: { srcAttr: '/x.png' },
          sourceRows: 1,
        },
        {
          topicId: '49',
          kind: 'performance/img-missing-dimensions',
          bucket: 'actionable',
          verdict: 'auto-set-dimensions',
          severity: 'moderate',
          rollupKey: '49|auto-set-dimensions|https://example.com/b',
          declarationSite: null,
          affectedUrlCount: 1,
          pageUrl: 'https://example.com/b',
          detail: 'missing width',
          autoFixable: true,
          reportOnly: false,
          surfaceClass: 'finding',
          proposedDiff: null,
          evidenceValues: { srcAttr: '/y.png' },
          sourceRows: 1,
        },
      ],
      internalEvidence: [],
    })

    const tree: RepoTreeEntry[] = [
      { path: 'public/a.html', sha: 'sha-a' },
      { path: 'public/b.html', sha: 'sha-b' },
    ]
    const listTree = vi.fn(async () => tree)
    const readFile = vi.fn(async (_creds: unknown, path: string) => {
      if (path === 'public/a.html') {
        return '<html><img src="/x.png"></html>'
      }
      if (path === 'public/b.html') {
        return '<html><img src="/y.png"></html>'
      }
      return null
    })

    const result = await resolveFindingSourcesForSite({
      siteId: 'site-resolve',
      userId: 'u1',
      deps: {
        creds: {
          owner: 'o',
          repo: 'r',
          baseBranch: 'main',
          accessToken: 't',
        },
        listTree,
        readFile,
      },
    })

    expect(listTree).toHaveBeenCalledTimes(1)
    expect(result.resolved + result.unresolved).toBe(2)
    // Same path never re-fetched — each distinct path read at most once.
    const paths = readFile.mock.calls.map((c) => c[1] as string)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('stops when deadline elapses and reports incomplete so the tick can resume', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 'site-budget',
      userId: 'u1',
      origin: 'https://example.com',
    })
    const findings = Array.from({ length: 5 }, (_, i) => ({
      topicId: '49',
      kind: 'performance/img-missing-dimensions',
      bucket: 'actionable' as const,
      verdict: 'auto-set-dimensions',
      severity: 'moderate',
      rollupKey: `49|auto-set-dimensions|https://example.com/p${i}`,
      declarationSite: null,
      affectedUrlCount: 1,
      pageUrl: `https://example.com/p${i}`,
      detail: 'missing',
      autoFixable: true,
      reportOnly: false,
      surfaceClass: 'finding' as const,
      proposedDiff: null,
      evidenceValues: { srcAttr: '/z.png' },
      sourceRows: 1,
    }))
    await store.upsertFindings({
      siteId: 'site-budget',
      detectOrigin: null,
      userId: 'u1',
      runId: run.id,
      findings,
      internalEvidence: [],
    })

    const deadlineAt = Date.now() - 1
    const result = await resolveFindingSourcesForSite({
      siteId: 'site-budget',
      userId: 'u1',
      deps: {
        creds: {
          owner: 'o',
          repo: 'r',
          baseBranch: 'main',
          accessToken: 't',
        },
        listTree: async () => [{ path: 'public/p0.html', sha: 's' }],
        readFile: async () => '<html><img src="/z.png"></html>',
      },
      deadlineAt,
    })

    expect(result.complete).toBe(false)
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(0)
  })
})

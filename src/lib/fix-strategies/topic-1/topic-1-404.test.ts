import { describe, expect, it } from 'vitest'
import { decide404Branch } from './decide-404'
import {
  contentSimilarity,
  pathSimilarity,
  scoreSuccessors,
} from './successor-similarity'
import {
  candidatePageRelPaths,
  findDeletedRouteEvidence,
  gitEvidenceUnavailable,
  type GitRunner,
} from './git-route-history'

/**
 * Offline git mock: answers shallow probe, path-history probe, and deletion log.
 */
function mockGit(opts: {
  shallow?: boolean
  /** When set, path-history probe returns this commit hash (reachable). */
  pathHistoryHash?: string | null
  /** stdout for `git log --diff-filter=D --summary` */
  deletionSummary?: string
  failShallow?: boolean
  failPathLog?: boolean
  failDeletionLog?: boolean
}): GitRunner {
  return async (args) => {
    if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') {
      if (opts.failShallow) {
        return { code: 128, stdout: '', stderr: 'not a git repository' }
      }
      return {
        code: 0,
        stdout: opts.shallow ? 'true\n' : 'false\n',
        stderr: '',
      }
    }
    if (
      args[0] === 'log' &&
      args[1] === '-1' &&
      args[2] === '--pretty=format:%H'
    ) {
      if (opts.failPathLog) {
        return { code: 128, stdout: '', stderr: 'bad object' }
      }
      const hash =
        opts.pathHistoryHash === undefined
          ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
          : opts.pathHistoryHash
      return { code: 0, stdout: hash ?? '', stderr: '' }
    }
    if (args[0] === 'log' && args.includes('--diff-filter=D')) {
      if (opts.failDeletionLog) {
        return { code: 128, stdout: '', stderr: 'fatal: bad revision' }
      }
      return {
        code: 0,
        stdout: opts.deletionSummary ?? '',
        stderr: '',
      }
    }
    return { code: 1, stdout: '', stderr: `unexpected git args: ${args.join(' ')}` }
  }
}

describe('pathSimilarity / contentSimilarity', () => {
  it('scores shared path segments', () => {
    expect(pathSimilarity('/blog/old-post', '/blog/new-post')).toBeGreaterThan(
      0.3,
    )
    expect(pathSimilarity('/a', '/z')).toBe(0)
  })

  it('scores overlapping main content without phrase-matching errors', () => {
    const a = '<main><h1>Charging guide</h1><p>Home chargers install tips</p></main>'
    const b = '<main><h1>Charging guide</h1><p>Home chargers install tips extra</p></main>'
    const c = '<main><h1>Unrelated</h1><p>Completely different topic here</p></main>'
    expect(contentSimilarity(a, b)).toBeGreaterThan(contentSimilarity(a, c))
  })
})

describe('scoreSuccessors', () => {
  it('returns only candidates above the floor', () => {
    const missing =
      '<main><h1>Privacy policy</h1><p>How we handle data and cookies</p></main>'
    const scored = scoreSuccessors(
      '/privacy-old',
      missing,
      [
        {
          url: 'https://ex.test/privacy',
          path: '/privacy',
          html: '<main><h1>Privacy policy</h1><p>How we handle data and cookies</p></main>',
        },
        {
          url: 'https://ex.test/about',
          path: '/about',
          html: '<main><h1>About us</h1><p>Company story</p></main>',
        },
      ],
      { floor: 0.4 },
    )
    expect(scored.length).toBe(1)
    expect(scored[0]?.path).toBe('/privacy')
  })
})

describe('findDeletedRouteEvidence', () => {
  it('maps URL paths to app page candidates', () => {
    expect(candidatePageRelPaths('/old')).toContain('app/old/page.tsx')
  })

  it('detects a deleted page file from git log summary', async () => {
    const evidence = await findDeletedRouteEvidence(
      '/repo',
      '/old',
      mockGit({
        shallow: false,
        deletionSummary: ' delete mode 100644 app/old/page.tsx\n',
      }),
    )
    expect(evidence.status).toBe('deleted')
    expect(evidence.deleted).toBe(true)
    expect(evidence.deletedPaths).toContain('app/old/page.tsx')
  })

  it('returns no-deletion-found when history is available and no match', async () => {
    const evidence = await findDeletedRouteEvidence(
      '/repo',
      '/old',
      mockGit({
        shallow: false,
        pathHistoryHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        deletionSummary: ' delete mode 100644 app/other/page.tsx\n',
      }),
    )
    expect(evidence.status).toBe('no-deletion-found')
    expect(evidence.deleted).toBe(false)
  })

  it('returns history-unavailable on a shallow clone with no matching deletion', async () => {
    const evidence = await findDeletedRouteEvidence(
      '/repo',
      '/old',
      mockGit({
        shallow: true,
        pathHistoryHash: null,
        deletionSummary: '',
      }),
    )
    expect(evidence.status).toBe('history-unavailable')
    expect(evidence.deleted).toBe(false)
    expect(evidence.detail).toMatch(/shallow/i)
  })

  it('still records deleted when a shallow tip contains the deletion', async () => {
    const evidence = await findDeletedRouteEvidence(
      '/repo',
      '/old',
      mockGit({
        shallow: true,
        deletionSummary: ' delete mode 100644 app/old/page.tsx\n',
      }),
    )
    expect(evidence.status).toBe('deleted')
    expect(evidence.deleted).toBe(true)
  })

  it('returns history-unavailable when git probes fail', async () => {
    const evidence = await findDeletedRouteEvidence(
      '/repo',
      '/old',
      mockGit({ failShallow: true }),
    )
    expect(evidence.status).toBe('history-unavailable')
  })

  it('returns history-unavailable when path history query fails', async () => {
    const evidence = await findDeletedRouteEvidence(
      '/repo',
      '/old',
      mockGit({ shallow: false, failPathLog: true }),
    )
    expect(evidence.status).toBe('history-unavailable')
  })
})

describe('decide404Branch', () => {
  const noDeletion = {
    status: 'no-deletion-found' as const,
    deleted: false,
    deletedPaths: [] as string[],
    detail: 'no deleted page file matched this URL path',
  }
  const unavailable = {
    status: 'history-unavailable' as const,
    deleted: false,
    deletedPaths: [] as string[],
    detail:
      'history-unavailable: shallow clone — absence of deletion evidence is not proof the route never existed',
  }
  const deleted = {
    status: 'deleted' as const,
    deleted: true,
    deletedPaths: ['app/old/page.tsx'],
    detail: 'deleted',
  }
  const one = [
    {
      url: 'https://ex.test/privacy',
      path: '/privacy',
      pathScore: 0.5,
      contentScore: 0.8,
      score: 0.7,
    },
  ]
  const two = [
    ...one,
    {
      url: 'https://ex.test/privacy-policy',
      path: '/privacy-policy',
      pathScore: 0.4,
      contentScore: 0.7,
      score: 0.6,
    },
  ]

  it('auto-removes when git deletion and no successor', () => {
    const d = decide404Branch({ git: deleted, successors: [] })
    expect(d.verdict).toBe('auto-fixable')
    expect(d.action).toBe('remove-anchor')
  })

  it('proposes 301 human-review for exactly one successor', () => {
    const d = decide404Branch({ git: deleted, successors: one })
    expect(d.verdict).toBe('human-review')
    expect(d.action).toBe('proposed-301')
  })

  it('does not tie-break two successors', () => {
    const d = decide404Branch({ git: noDeletion, successors: two })
    expect(d.verdict).toBe('human-review')
    expect(d.action).toBe('ambiguous-successors')
  })

  it('scaffolds recreate only when no-deletion-found and no successor', () => {
    const d = decide404Branch({ git: noDeletion, successors: [] })
    expect(d.verdict).toBe('human-review')
    expect(d.action).toBe('recreate-scaffold')
  })

  it('routes history-unavailable to human-review, never recreate-scaffold or remove-anchor', () => {
    const d = decide404Branch({ git: unavailable, successors: [] })
    expect(d.verdict).toBe('human-review')
    expect(d.action).toBe('history-unavailable')
    expect(d.action).not.toBe('recreate-scaffold')
    expect(d.action).not.toBe('remove-anchor')
    expect(d.reason).toMatch(/shallow|history-unavailable/i)
  })

  it('does not treat gitEvidenceUnavailable() as recreate-scaffold', () => {
    const d = decide404Branch({
      git: gitEvidenceUnavailable(),
      successors: [],
    })
    expect(d.action).toBe('history-unavailable')
  })

  it('does not gate on GSC impressions', () => {
    const d = decide404Branch({
      git: deleted,
      successors: [],
      gscImpressions: 999,
    })
    expect(d.action).toBe('remove-anchor')
  })
})

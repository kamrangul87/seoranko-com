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
  type GitRunner,
} from './git-route-history'

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
    const runGit: GitRunner = async () => ({
      code: 0,
      stdout: ' delete mode 100644 app/old/page.tsx\n',
      stderr: '',
    })
    const evidence = await findDeletedRouteEvidence('/repo', '/old', runGit)
    expect(evidence.deleted).toBe(true)
    expect(evidence.deletedPaths).toContain('app/old/page.tsx')
  })

  it('returns not-deleted when no matching path appears', async () => {
    const runGit: GitRunner = async () => ({
      code: 0,
      stdout: ' delete mode 100644 app/other/page.tsx\n',
      stderr: '',
    })
    const evidence = await findDeletedRouteEvidence('/repo', '/old', runGit)
    expect(evidence.deleted).toBe(false)
  })
})

describe('decide404Branch', () => {
  const noGit = {
    deleted: false,
    deletedPaths: [],
    detail: 'none',
  }
  const deleted = {
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
    const d = decide404Branch({ git: noGit, successors: two })
    expect(d.verdict).toBe('human-review')
    expect(d.action).toBe('ambiguous-successors')
  })

  it('scaffolds recreate when no git deletion and no successor', () => {
    const d = decide404Branch({ git: noGit, successors: [] })
    expect(d.verdict).toBe('human-review')
    expect(d.action).toBe('recreate-scaffold')
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

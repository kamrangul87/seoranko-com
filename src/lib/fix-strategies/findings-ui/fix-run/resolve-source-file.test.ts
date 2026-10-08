/**
 * resolveSourceFile — one test per unresolved reason; resolved cases;
 * generated sitemap excluded; changed blob SHA forces re-resolution.
 */

import { describe, expect, it } from 'vitest'
import {
  candidatePathsForUrl,
  countExactOccurrences,
  detectStaticRoots,
  resolveSourceFile,
  whySourceUnresolved,
} from './resolve-source-file'
import {
  blobShaChanged,
  resolveOneFindingSource,
} from './resolve-finding-sources'
import type { PersistedFindingRow } from '../crawl/constants'
import {
  evidenceNeedleForResolution,
  resolutionUrlForFinding,
} from './apply-evidence'

const AUTODUN_TREE = [
  'public/about/index.html',
  'public/blog/index.html',
  'public/blog/mot-cost-uk-2026.html',
  'public/robots.txt',
  'public/sitemap.xml',
  'public/index.html',
  'src/main.tsx',
  'package.json',
]

function finding(
  partial: Partial<PersistedFindingRow> &
    Pick<PersistedFindingRow, 'id' | 'topicId' | 'verdict'>,
): PersistedFindingRow {
  const now = new Date().toISOString()
  return {
    siteId: 'site-1',
    detectOrigin: null,
    userId: 'user-1',
    kind: `topic/${partial.topicId}`,
    bucket: 'actionable',
    severity: 'moderate',
    rollupKey: `${partial.topicId}|${partial.verdict}`,
    declarationSite: null,
    affectedUrlCount: 1,
    pageUrl: null,
    detail: '',
    autoFixable: true,
    reportOnly: false,
    surfaceClass: 'finding',
    proposedDiff: null,
    evidenceValues: null,
    sourceRows: [],
    sourcePath: null,
    sourceBlobSha: null,
    sourceResolvedAt: null,
    sourceUnresolvedReason: null,
    firstSeenRunId: null,
    lastSeenRunId: null,
    firstSeenAt: now,
    lastSeenAt: now,
    status: 'open',
    resolvedAt: null,
    fixedAt: null,
    verificationAt: null,
    postFixStatus: null,
    regressionObservedAt: null,
    ...partial,
  }
}

describe('detectStaticRoots + candidates', () => {
  it('detects public/ on autodun-like tree (does not assume)', () => {
    expect(detectStaticRoots(AUTODUN_TREE)).toContain('public')
  })

  it('fixture-like tree: "/" resolves to index.html, not blog/index.html', async () => {
    const tree = [
      'index.html',
      'about.html',
      'blog/index.html',
      'robots.txt',
      'sitemap.xml',
    ]
    const roots = detectStaticRoots(tree)
    expect(roots).toEqual([''])
    const existing = candidatePathsForUrl('https://seoranko-fixture.vercel.app/', roots).filter(
      (p) => tree.includes(p),
    )
    // Pre-fix bug: candidates were [index.html, blog/index.html]
    expect(existing).toEqual(['index.html'])
    const result = await resolveSourceFile({
      url: 'https://seoranko-fixture.vercel.app/',
      evidence: { needle: 'Fixture home', expectedCount: 1 },
      treePaths: tree,
      treeShas: { 'index.html': 'sha-root' },
      readFile: async () => '<html><body><h1>Fixture home</h1></body></html>',
    })
    expect(result).toMatchObject({ status: 'resolved', path: 'index.html' })
  })

  it('maps /about → public/about/index.html candidate only when present', () => {
    const roots = detectStaticRoots(AUTODUN_TREE)
    const cands = candidatePathsForUrl('https://autodun.com/about', roots)
    expect(cands).toContain('public/about/index.html')
    expect(cands).toContain('public/about.html')
    const existing = cands.filter((p) => AUTODUN_TREE.includes(p))
    expect(existing).toEqual(['public/about/index.html'])
  })

  it('maps /blog and /blog/index.html to the same index candidate', () => {
    const roots = detectStaticRoots(AUTODUN_TREE)
    const a = candidatePathsForUrl('https://autodun.com/blog', roots).filter(
      (p) => AUTODUN_TREE.includes(p),
    )
    const b = candidatePathsForUrl(
      'https://autodun.com/blog/index.html',
      roots,
    ).filter((p) => AUTODUN_TREE.includes(p))
    expect(a).toEqual(['public/blog/index.html'])
    expect(b).toEqual(['public/blog/index.html'])
  })
})

describe('unresolved reasons', () => {
  it('no-static-file — framework/generated (no matching blob)', async () => {
    const result = await resolveSourceFile({
      url: 'https://example.com/app-only-page',
      evidence: { needle: 'hello', expectedCount: 1 },
      treePaths: ['app/page.tsx', 'app/sitemap.ts'],
      treeShas: {},
      readFile: async () => null,
    })
    expect(result.status).toBe('unresolved')
    if (result.status === 'unresolved') {
      expect(result.reason).toBe('no-static-file')
      expect(whySourceUnresolved(result.reason)).toMatch(/framework-rendered|generated/)
    }
  })

  it('multiple-candidates — both p.html and p/index.html exist', async () => {
    const tree = ['public/about.html', 'public/about/index.html']
    const result = await resolveSourceFile({
      url: 'https://example.com/about',
      evidence: { needle: 'About', expectedCount: 1 },
      treePaths: tree,
      treeShas: {
        'public/about.html': 'sha-a',
        'public/about/index.html': 'sha-b',
      },
      readFile: async () => '<html>About</html>',
    })
    expect(result.status).toBe('unresolved')
    if (result.status === 'unresolved') {
      expect(result.reason).toBe('multiple-candidates')
    }
  })

  it('evidence-not-found — candidate exists but needle absent', async () => {
    const result = await resolveSourceFile({
      url: 'https://example.com/about',
      evidence: { needle: 'MISSING-NEEDLE', expectedCount: 1 },
      treePaths: ['public/about/index.html'],
      treeShas: { 'public/about/index.html': 'sha1' },
      readFile: async () => '<html><body>About us</body></html>',
    })
    expect(result.status).toBe('unresolved')
    if (result.status === 'unresolved') {
      expect(result.reason).toBe('evidence-not-found')
    }
  })

  it('evidence-ambiguous — wrong occurrence count', async () => {
    const body = 'foo X foo X foo'
    expect(countExactOccurrences(body, 'foo')).toBe(3)
    const result = await resolveSourceFile({
      url: 'https://example.com/about',
      evidence: { needle: 'foo', expectedCount: 1 },
      treePaths: ['public/about/index.html'],
      treeShas: { 'public/about/index.html': 'sha1' },
      readFile: async () => body,
    })
    expect(result.status).toBe('unresolved')
    if (result.status === 'unresolved') {
      expect(result.reason).toBe('evidence-ambiguous')
    }
  })
})

describe('resolved cases per wired topic', () => {
  const files: Record<string, string> = {
    'public/blog/index.html':
      '<html><a href="/dead-page">x</a><link rel="canonical" href="https://autodun.com/wrong"><img src="/images/hero.jpg"></html>',
    'public/about/index.html':
      '<html><link rel="canonical" href="https://autodun.com/about"><link rel="canonical" href="https://autodun.com/about"></html>',
    'public/robots.txt': 'User-agent: *\nCrawl-delay: 10\nAllow: /\n',
    'public/sitemap.xml':
      '<?xml version="1.0"?><urlset><url><loc>https://autodun.com/gone</loc></url></urlset>',
  }
  const treePaths = Object.keys(files)
  const treeShas = Object.fromEntries(treePaths.map((p) => [p, `sha-${p}`]))
  const readFile = async (path: string) => files[path] ?? null

  it('topic 1 — href in page HTML', async () => {
    const result = await resolveSourceFile({
      url: 'https://autodun.com/blog',
      evidence: { needle: '/dead-page', expectedCount: 1 },
      treePaths,
      treeShas,
      readFile,
    })
    expect(result).toMatchObject({
      status: 'resolved',
      path: 'public/blog/index.html',
      blobSha: 'sha-public/blog/index.html',
    })
  })

  it('topic 14 — broken canonicalUrl needle', async () => {
    const result = await resolveSourceFile({
      url: 'https://autodun.com/blog',
      evidence: {
        needle: 'https://autodun.com/wrong',
        expectedCount: 1,
      },
      treePaths,
      treeShas,
      readFile,
    })
    expect(result).toMatchObject({
      status: 'resolved',
      path: 'public/blog/index.html',
    })
  })

  it('topic 17 — collapseTo in file', async () => {
    const result = await resolveSourceFile({
      url: 'https://autodun.com/about',
      evidence: {
        needle: 'https://autodun.com/about',
        expectedCount: 2,
      },
      treePaths,
      treeShas,
      readFile,
    })
    expect(result).toMatchObject({
      status: 'resolved',
      path: 'public/about/index.html',
    })
  })

  it('topic 22 — crawl-delay raw line', async () => {
    const result = await resolveSourceFile({
      url: 'https://autodun.com/robots.txt',
      evidence: { needle: 'Crawl-delay: 10', expectedCount: 1 },
      treePaths,
      treeShas,
      readFile,
    })
    expect(result).toMatchObject({
      status: 'resolved',
      path: 'public/robots.txt',
    })
  })

  it('topic 26 — loc in static sitemap', async () => {
    const result = await resolveSourceFile({
      url: 'https://autodun.com/sitemap.xml',
      evidence: {
        needle: 'https://autodun.com/gone',
        expectedCount: 1,
      },
      treePaths,
      treeShas,
      readFile,
    })
    expect(result).toMatchObject({
      status: 'resolved',
      path: 'public/sitemap.xml',
    })
  })

  it('topic 42 — href rewrite needle', async () => {
    const result = await resolveSourceFile({
      url: 'https://autodun.com/blog',
      evidence: { needle: '/dead-page', expectedCount: 1 },
      treePaths,
      treeShas,
      readFile,
    })
    expect(result.status).toBe('resolved')
  })

  it('topic 49 — srcAttr needle', async () => {
    const result = await resolveSourceFile({
      url: 'https://autodun.com/blog',
      evidence: { needle: '/images/hero.jpg', expectedCount: 1 },
      treePaths,
      treeShas,
      readFile,
    })
    expect(result).toMatchObject({
      status: 'resolved',
      path: 'public/blog/index.html',
    })
  })
})

describe('generated sitemap excluded', () => {
  it('app/sitemap.ts alone → no-static-file for /sitemap.xml', async () => {
    const result = await resolveSourceFile({
      url: 'https://example.com/sitemap.xml',
      evidence: {
        needle: 'https://example.com/page',
        expectedCount: 1,
      },
      treePaths: ['app/sitemap.ts', 'app/page.tsx'],
      treeShas: {},
      readFile: async () => null,
    })
    expect(result.status).toBe('unresolved')
    if (result.status === 'unresolved') {
      expect(result.reason).toBe('no-static-file')
    }
  })
})

describe('blob SHA change forces re-resolution', () => {
  it('blobShaChanged is true when tip differs', () => {
    const f = finding({
      id: 'f1',
      topicId: '26',
      verdict: 'auto-remove-confirmed-4xx',
      sourcePath: 'public/sitemap.xml',
      sourceBlobSha: 'old-sha',
    })
    expect(blobShaChanged(f, { 'public/sitemap.xml': 'new-sha' })).toBe(true)
    expect(blobShaChanged(f, { 'public/sitemap.xml': 'old-sha' })).toBe(false)
  })

  it('resolveOneFindingSource re-resolves after SHA change', async () => {
    const f = finding({
      id: 'f-sha',
      topicId: '22',
      verdict: 'auto-remove-crawl-delay',
      pageUrl: 'https://autodun.com/robots.txt',
      evidenceValues: { crawlDelayLines: ['Crawl-delay: 10'] },
      sourcePath: 'public/robots.txt',
      sourceBlobSha: 'stale-sha',
      surfaceClass: 'auto-fixable',
      autoFixable: true,
    })
    expect(evidenceNeedleForResolution(f)?.needle).toBe('Crawl-delay: 10')
    expect(resolutionUrlForFinding(f)).toBe('https://autodun.com/robots.txt')

    const tree = [{ path: 'public/robots.txt', sha: 'fresh-sha' }]
    const patch = await resolveOneFindingSource({
      siteId: 'site-1',
      finding: f,
      tree,
      treeShas: { 'public/robots.txt': 'fresh-sha' },
      readFile: async () => 'User-agent: *\nCrawl-delay: 10\n',
    })
    expect(patch.sourcePath).toBe('public/robots.txt')
    expect(patch.sourceBlobSha).toBe('fresh-sha')
    expect(patch.sourceUnresolvedReason).toBeNull()
  })
})

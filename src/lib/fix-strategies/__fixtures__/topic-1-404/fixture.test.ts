import { describe, expect, it, vi } from 'vitest'
import { detectBrokenInternalLinks } from '@/lib/fix-strategies/topic-1'
import type { FetchDeps } from '@/lib/fix-strategies/fetch'
import type { GitRunner } from '@/lib/fix-strategies/topic-1'
import type { RouteRoot } from '@/lib/fix-strategies/site-model'

const HOST = 'https://fixture.test'

// Explicit site-model roots — fixtures must not rely on a default app/ probe.
const FIXTURE_ROOTS: RouteRoot[] = [
  { relDir: 'app', absDir: '/fixture-repo/app', kind: 'app-router' },
]

function sourceHtml(): string {
  return `<!doctype html><html><body>
    <a href="/gone-410">410</a>
    <a href="/deleted-page">deleted 404</a>
    <a href="/moved-once">one successor</a>
    <a href="/moved-many">two successors</a>
    <a href="/never-existed">no deletion found</a>
    <a href="/shallow-unknown">history unavailable</a>
    <a href="mailto:x@fixture.test">mail</a>
    <a href="#">top</a>
    <a href="/healthy">ok</a>
  </body></html>`
}

function depsWithStatus(map: Record<string, number>): FetchDeps {
  return {
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      const status = map[path] ?? 200
      return new Response(`status-${status}`, { status })
    }) as unknown as typeof fetch,
    sleep: vi.fn(async () => {}),
    now: () => 0,
    config: {
      fallbackDelayMs: 1,
      maxAttempts: 2,
      maxRetryAfterMs: 10,
      timeoutMs: 200,
    },
  }
}

/**
 * Full-history runner: deletions listed; shallow=false.
 * `/never-existed` has no matching delete line → no-deletion-found.
 */
const runGitFull: GitRunner = async (args) => {
  if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') {
    return { code: 0, stdout: 'false\n', stderr: '' }
  }
  if (args[0] === 'log' && args[1] === '-1' && args[2] === '--pretty=format:%H') {
    const paths = args.slice(args.indexOf('--') + 1)
    // never-existed candidates have no history; others do
    if (paths.some((p) => p.includes('never-existed'))) {
      return { code: 0, stdout: '', stderr: '' }
    }
    return {
      code: 0,
      stdout: 'cccccccccccccccccccccccccccccccccccccccc',
      stderr: '',
    }
  }
  if (args[0] === 'log' && args.includes('--diff-filter=D')) {
    return {
      code: 0,
      stdout: [
        ' delete mode 100644 app/deleted-page/page.tsx',
        ' delete mode 100644 app/moved-once/page.tsx',
        ' delete mode 100644 app/moved-many/page.tsx',
        // deliberately omit never-existed and shallow-unknown
      ].join('\n'),
      stderr: '',
    }
  }
  return { code: 1, stdout: '', stderr: `unexpected: ${args.join(' ')}` }
}

/**
 * Shallow runner: same tip as full for deleted-page, but shallow=true so
 * `/shallow-unknown` (no matching deletion) becomes history-unavailable.
 */
const runGitShallow: GitRunner = async (args) => {
  if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') {
    return { code: 0, stdout: 'true\n', stderr: '' }
  }
  if (args[0] === 'log' && args[1] === '-1' && args[2] === '--pretty=format:%H') {
    return { code: 0, stdout: '', stderr: '' }
  }
  if (args[0] === 'log' && args.includes('--diff-filter=D')) {
    return {
      code: 0,
      stdout: ' delete mode 100644 app/deleted-page/page.tsx\n',
      stderr: '',
    }
  }
  return { code: 1, stdout: '', stderr: `unexpected: ${args.join(' ')}` }
}

describe('topic-1 404 decision-tree fixture', () => {
  it('chooses the correct branch for each 404 evidence shape', async () => {
    const deps = depsWithStatus({
      '/gone-410': 410,
      '/deleted-page': 404,
      '/moved-once': 404,
      '/moved-many': 404,
      '/never-existed': 404,
      '/shallow-unknown': 404,
      '/healthy': 200,
    })

    const widgetBody =
      '<main><h1>Widget torque guide</h1><p>Exact newton metre specs for flange bolts</p></main>'
    const privacyBody =
      '<main><h1>Privacy policy</h1><p>How we handle personal data and cookies here</p></main>'

    const historical = {
      '/moved-once': widgetBody,
      '/moved-many': privacyBody,
    }

    const livePages = [
      {
        url: `${HOST}/guides/widget-torque`,
        path: '/guides/widget-torque',
        html: widgetBody,
      },
      {
        url: `${HOST}/privacy`,
        path: '/privacy',
        html: privacyBody,
      },
      {
        url: `${HOST}/privacy-policy`,
        path: '/privacy-policy',
        html: privacyBody,
      },
      {
        url: `${HOST}/healthy`,
        path: '/healthy',
        html: '<main><h1>Healthy</h1><p>Unrelated live page</p></main>',
      },
    ]

    const result = await detectBrokenInternalLinks(sourceHtml(), `${HOST}/home`, {
      deps,
      repoRoot: '/fixture-repo',
      runGit: runGitFull,
      routeRoots: FIXTURE_ROOTS,
      livePages,
      historicalHtmlByPath: historical,
      similarityConfig: { floor: 0.4 },
      gscImpressionsByPath: { '/never-existed': 50 },
    })

    const byHref = Object.fromEntries(result.findings.map((f) => [f.href, f]))

    expect(byHref['/gone-410']?.kind).toBe('broken-internal-link/410')

    expect(byHref['/deleted-page']?.kind).toBe('broken-internal-link/404')
    if (byHref['/deleted-page']?.kind === 'broken-internal-link/404') {
      expect(byHref['/deleted-page'].action).toBe('remove-anchor')
      expect(byHref['/deleted-page'].verdict).toBe('auto-fixable')
      expect(byHref['/deleted-page'].git.status).toBe('deleted')
    }

    expect(byHref['/moved-once']?.kind).toBe('broken-internal-link/404')
    if (byHref['/moved-once']?.kind === 'broken-internal-link/404') {
      expect(byHref['/moved-once'].action).toBe('proposed-301')
      expect(byHref['/moved-once'].verdict).toBe('human-review')
      expect(byHref['/moved-once'].successors).toHaveLength(1)
      expect(byHref['/moved-once'].successors[0]?.path).toBe(
        '/guides/widget-torque',
      )
    }

    expect(byHref['/moved-many']?.kind).toBe('broken-internal-link/404')
    if (byHref['/moved-many']?.kind === 'broken-internal-link/404') {
      expect(byHref['/moved-many'].action).toBe('ambiguous-successors')
      expect(byHref['/moved-many'].successors.length).toBeGreaterThanOrEqual(2)
    }

    // Full history, no matching deletion + no-route → no-action (guard 9).
    // recreate-scaffold only when site model shows positive route existence.
    expect(byHref['/never-existed']?.kind).toBe('broken-internal-link/404')
    if (byHref['/never-existed']?.kind === 'broken-internal-link/404') {
      expect(byHref['/never-existed'].git.status).toBe('no-deletion-found')
      expect(byHref['/never-existed'].routeKind).toBe('no-route')
      expect(byHref['/never-existed'].action).toBe('no-action')
      expect(byHref['/never-existed'].verdict).toBe('human-review')
      expect(byHref['/never-existed'].action).not.toBe('recreate-scaffold')
    }

    // With full-history runner, /shallow-unknown also has no deletion + no-route → no-action.
    // Dedicated shallow case is the next test.
    if (byHref['/shallow-unknown']?.kind === 'broken-internal-link/404') {
      expect(byHref['/shallow-unknown'].git.status).toBe('no-deletion-found')
      expect(byHref['/shallow-unknown'].action).toBe('no-action')
    }

    const reasons = result.suppressed.map((s) => s.reason)
    expect(reasons).toContain('scheme-filter')
    expect(reasons).toContain('healthy-200')
  })

  it('routes history-unavailable (shallow) to human-review, not recreate-scaffold', async () => {
    const html = `<!doctype html><html><body>
      <a href="/deleted-page">deleted</a>
      <a href="/shallow-unknown">unknown on shallow</a>
    </body></html>`

    const deps = depsWithStatus({
      '/deleted-page': 404,
      '/shallow-unknown': 404,
    })

    const result = await detectBrokenInternalLinks(html, `${HOST}/home`, {
      deps,
      repoRoot: '/fixture-repo-shallow',
      runGit: runGitShallow,
      routeRoots: FIXTURE_ROOTS,
      livePages: [],
    })

    const byHref = Object.fromEntries(result.findings.map((f) => [f.href, f]))

    // Positive deletion in the shallow tip is still trusted
    expect(byHref['/deleted-page']?.kind).toBe('broken-internal-link/404')
    if (byHref['/deleted-page']?.kind === 'broken-internal-link/404') {
      expect(byHref['/deleted-page'].git.status).toBe('deleted')
      expect(byHref['/deleted-page'].action).toBe('remove-anchor')
    }

    expect(byHref['/shallow-unknown']?.kind).toBe('broken-internal-link/404')
    if (byHref['/shallow-unknown']?.kind === 'broken-internal-link/404') {
      expect(byHref['/shallow-unknown'].git.status).toBe('history-unavailable')
      expect(byHref['/shallow-unknown'].action).toBe('history-unavailable')
      expect(byHref['/shallow-unknown'].verdict).toBe('human-review')
      expect(byHref['/shallow-unknown'].action).not.toBe('recreate-scaffold')
      expect(byHref['/shallow-unknown'].action).not.toBe('remove-anchor')
      expect(byHref['/shallow-unknown'].reason).toMatch(/shallow|history-unavailable/i)
    }
  })

  it('treats missing runGit as history-unavailable, not recreate-scaffold', async () => {
    const html = `<!doctype html><html><body>
      <a href="/orphan-404">orphan</a>
    </body></html>`

    const deps = depsWithStatus({ '/orphan-404': 404 })

    const result = await detectBrokenInternalLinks(html, `${HOST}/home`, {
      deps,
      // no repoRoot / runGit
      livePages: [],
    })

    const finding = result.findings.find((f) => f.href === '/orphan-404')
    expect(finding?.kind).toBe('broken-internal-link/404')
    if (finding?.kind === 'broken-internal-link/404') {
      expect(finding.git.status).toBe('history-unavailable')
      expect(finding.action).toBe('history-unavailable')
      expect(finding.verdict).toBe('human-review')
    }
  })

  it('dynamic-route pattern + no slug deletion → no-action (guard 9), never recreate-scaffold', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')

    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'topic1-dyn-'))
    const appDir = path.join(repoRoot, 'app')
    const slugDir = path.join(appDir, 'blog', '[slug]')
    fs.mkdirSync(slugDir, { recursive: true })
    fs.writeFileSync(
      path.join(slugDir, 'page.tsx'),
      'export default function Page(){return null}\n',
    )
    fs.writeFileSync(
      path.join(slugDir, 'loading.tsx'),
      'export default function Loading(){return null}\n',
    )
    fs.writeFileSync(
      path.join(appDir, 'page.tsx'),
      'export default function Home(){return null}\n',
    )

    const roots: RouteRoot[] = [
      { relDir: 'app', absDir: appDir, kind: 'app-router' },
    ]

    const runGitNoSlugDelete: GitRunner = async (args) => {
      if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') {
        return { code: 0, stdout: 'false\n', stderr: '' }
      }
      if (
        args[0] === 'log' &&
        args[1] === '-1' &&
        args[2] === '--pretty=format:%H'
      ) {
        // Slug-specific candidates never existed as static files
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args[0] === 'log' && args.includes('--diff-filter=D')) {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: `unexpected: ${args.join(' ')}` }
    }

    const html = `<!doctype html><html><body>
      <a href="/blog/missing-slug">gone slug</a>
    </body></html>`

    const deps = depsWithStatus({ '/blog/missing-slug': 404 })

    const result = await detectBrokenInternalLinks(html, `${HOST}/home`, {
      deps,
      repoRoot,
      routeRoots: roots,
      runGit: runGitNoSlugDelete,
      livePages: [],
    })

    const finding = result.findings.find((f) => f.href === '/blog/missing-slug')
    expect(finding?.kind).toBe('broken-internal-link/404')
    if (finding?.kind === 'broken-internal-link/404') {
      expect(finding.routeKind).toBe('dynamic-route')
      expect(finding.git.status).toBe('no-deletion-found')
      expect(finding.verdict).toBe('human-review')
      expect(finding.action).toBe('no-action')
      expect(finding.action).not.toBe('recreate-scaffold')
      expect(finding.reason).toMatch(/guard 9|pattern|slug-specific/i)
    }

    fs.rmSync(repoRoot, { recursive: true, force: true })
  })
})

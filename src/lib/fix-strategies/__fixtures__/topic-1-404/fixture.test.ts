import { describe, expect, it, vi } from 'vitest'
import { detectBrokenInternalLinks } from '@/lib/fix-strategies/topic-1'
import type { FetchDeps } from '@/lib/fix-strategies/fetch'
import type { GitRunner } from '@/lib/fix-strategies/topic-1'

const HOST = 'https://fixture.test'

function sourceHtml(): string {
  return `<!doctype html><html><body>
    <a href="/gone-410">410</a>
    <a href="/deleted-page">deleted 404</a>
    <a href="/moved-once">one successor</a>
    <a href="/moved-many">two successors</a>
    <a href="/never-existed">no evidence</a>
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

const runGit: GitRunner = async () => ({
  code: 0,
  stdout: [
    ' delete mode 100644 app/deleted-page/page.tsx',
    ' delete mode 100644 app/moved-once/page.tsx',
    ' delete mode 100644 app/moved-many/page.tsx',
  ].join('\n'),
  stderr: '',
})

describe('topic-1 404 decision-tree fixture', () => {
  it('chooses the correct branch for each 404 evidence shape', async () => {
    const deps = depsWithStatus({
      '/gone-410': 410,
      '/deleted-page': 404,
      '/moved-once': 404,
      '/moved-many': 404,
      '/never-existed': 404,
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
      runGit,
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

    expect(byHref['/never-existed']?.kind).toBe('broken-internal-link/404')
    if (byHref['/never-existed']?.kind === 'broken-internal-link/404') {
      expect(byHref['/never-existed'].action).toBe('recreate-scaffold')
      expect(byHref['/never-existed'].verdict).toBe('human-review')
    }

    const reasons = result.suppressed.map((s) => s.reason)
    expect(reasons).toContain('scheme-filter')
    expect(reasons).toContain('healthy-200')
  })
})

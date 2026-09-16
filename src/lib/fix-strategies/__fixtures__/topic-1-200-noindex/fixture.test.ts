import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectBrokenInternalLinks } from '@/lib/fix-strategies/topic-1'
import type { FetchDeps } from '@/lib/fix-strategies/fetch'
import type { GitRunner } from '@/lib/fix-strategies/topic-1'
import type { RouteRoot } from '@/lib/fix-strategies/site-model'

const HOST = 'https://fixture.test'

const temps: string[] = []

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Stage 3 fixture — 200 + noindex branches (topic 1 + topic 70 discriminator).
 *
 * Synthetic App Router tree:
 * - `/blog/[slug]` + `loading.tsx` — dynamic route; live response is 200 with
 *   injected noindex (streamed notFound mid-stream, R32 / topic 67). Repo does
 *   NOT declare noindex → raise as soft-404.
 * - `/private` — deliberately noindexed valid page (static metadata) → suppress.
 * - `/draft` — conditional generateMetadata robots → indeterminate human-review.
 */
function buildFixtureRepo(): { repoRoot: string; appDir: string; roots: RouteRoot[] } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'topic1-200ni-'))
  temps.push(repoRoot)
  const appDir = path.join(repoRoot, 'app')

  // Dynamic route with loading.tsx — streamed notFound case (R32).
  // Existence check after the streaming boundary; no repo noindex declaration.
  const blogSlug = path.join(appDir, 'blog', '[slug]')
  fs.mkdirSync(blogSlug, { recursive: true })
  fs.writeFileSync(
    path.join(blogSlug, 'page.tsx'),
    `
export default async function Page({ params }: { params: { slug: string } }) {
  // notFound() fires after streaming has begun (loading.tsx present)
  return null
}
`.trim() + '\n',
  )
  fs.writeFileSync(
    path.join(blogSlug, 'loading.tsx'),
    `export default function Loading(){return null}\n`,
  )

  // Deliberately noindexed valid page.
  const privateDir = path.join(appDir, 'private')
  fs.mkdirSync(privateDir, { recursive: true })
  fs.writeFileSync(
    path.join(privateDir, 'page.tsx'),
    `
export const metadata = { robots: { index: false } }
export default function Page(){return null}
`.trim() + '\n',
  )

  // Conditional generateMetadata → indeterminate.
  const draftDir = path.join(appDir, 'draft')
  fs.mkdirSync(draftDir, { recursive: true })
  fs.writeFileSync(
    path.join(draftDir, 'page.tsx'),
    `
export async function generateMetadata({ searchParams }: { searchParams: { draft?: string } }) {
  if (searchParams.draft) return { robots: { index: false } }
  return { robots: { index: true } }
}
export default function Page(){return null}
`.trim() + '\n',
  )

  // Home (source page route).
  fs.writeFileSync(
    path.join(appDir, 'page.tsx'),
    `export default function Home(){return null}\n`,
  )

  return {
    repoRoot,
    appDir,
    roots: [{ relDir: 'app', absDir: appDir, kind: 'app-router' }],
  }
}

function noindexHtml(title: string): string {
  return `<!doctype html><html><head><title>${title}</title><meta name="robots" content="noindex"></head><body><p>${title}</p></body></html>`
}

function sourceHtml(): string {
  return `<!doctype html><html><body>
    <a href="/blog/missing-post">streamed soft 404</a>
    <a href="/private">deliberate noindex</a>
    <a href="/draft">conditional metadata</a>
    <a href="/healthy">ok</a>
    <a href="mailto:x@fixture.test">mail</a>
  </body></html>`
}

function depsServing(map: Record<string, { status: number; body: string }>): FetchDeps {
  return {
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname
      const page = map[pathname]
      if (!page) return new Response('not found', { status: 404 })
      return new Response(page.body, {
        status: page.status,
        headers: { 'content-type': 'text/html' },
      })
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

/** Full-history git: soft-404 path has a deletion → auto remove-anchor. */
const runGitDeleted: GitRunner = async (args) => {
  if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') {
    return { code: 0, stdout: 'false\n', stderr: '' }
  }
  if (args[0] === 'log' && args[1] === '-1' && args[2] === '--pretty=format:%H') {
    return {
      code: 0,
      stdout: 'dddddddddddddddddddddddddddddddddddddddd',
      stderr: '',
    }
  }
  if (args[0] === 'log' && args.includes('--diff-filter=D')) {
    return {
      code: 0,
      stdout: ' delete mode 100644 app/blog/[slug]/page.tsx\n',
      stderr: '',
    }
  }
  return { code: 1, stdout: '', stderr: `unexpected: ${args.join(' ')}` }
}

describe('topic-1 Stage 3 — 200 + noindex discriminator', () => {
  it('raises on streamed soft 404, suppresses deliberate noindex, human-reviews indeterminate', async () => {
    const { repoRoot, roots } = buildFixtureRepo()

    const deps = depsServing({
      // Dynamic route + loading.tsx; notFound mid-stream → 200 + injected noindex (R32)
      '/blog/missing-post': {
        status: 200,
        body: noindexHtml('Not Found'),
      },
      '/private': {
        status: 200,
        body: noindexHtml('Private but valid'),
      },
      '/draft': {
        status: 200,
        body: noindexHtml('Draft maybe'),
      },
      '/healthy': {
        status: 200,
        body: '<!doctype html><html><head><title>Ok</title></head><body><p>ok</p></body></html>',
      },
    })

    const result = await detectBrokenInternalLinks(sourceHtml(), `${HOST}/`, {
      deps,
      repoRoot,
      routeRoots: roots,
      runGit: runGitDeleted,
    })

    const soft = result.findings.filter((f) => f.kind === 'broken-internal-link/soft-404')
    const indeterminate = result.findings.filter(
      (f) => f.kind === 'broken-internal-link/200-noindex',
    )

    expect(soft).toHaveLength(1)
    expect(soft[0]?.href).toBe('/blog/missing-post')
    expect(soft[0]?.cause).toBe('injected-noindex')
    // Dynamic route still exists in repo; slug-specific path has no deletion
    // match → 404-branch recreate-scaffold (raised, not suppressed).
    expect(soft[0]?.verdict).toBe('human-review')
    expect(soft[0]?.action).toBe('recreate-scaffold')

    expect(indeterminate).toHaveLength(1)
    expect(indeterminate[0]?.href).toBe('/draft')
    expect(indeterminate[0]?.verdict).toBe('human-review')
    expect(indeterminate[0]?.action).toBe('indeterminate-noindex')

    expect(
      result.suppressed.some(
        (s) => s.href === '/private' && s.reason === 'deliberate-noindex',
      ),
    ).toBe(true)
    expect(
      result.suppressed.some(
        (s) => s.href === '/healthy' && s.reason === 'healthy-200',
      ),
    ).toBe(true)
    expect(
      result.suppressed.some(
        (s) => s.href === 'mailto:x@fixture.test' && s.reason === 'scheme-filter',
      ),
    ).toBe(true)

    // Only the two non-suppressed 200+noindex outcomes raise findings
    expect(result.findings).toHaveLength(2)
  })
})

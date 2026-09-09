import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  findBestGithubSourceMatch,
  isDirectPushBlocked,
  githubTokenKindHint,
  githubAdapter,
  isStaleClientFixBranch,
  deleteStaleSeorankoFixBranches,
} from './github-adapter'

const autodunLikeTree = [
  'index.html',
  'README.md',
  'public/index.html',
  'public/contact/index.html',
  'public/about/index.html',
  'public/blog/index.html',
  'public/blog/mot-cost-uk-2026.html',
  'public/blog/ulez-checker-uk.html',
  'content/autodun-contact.html',
  'src/app/page.tsx',
  'src/app/contact/page.tsx',
].map((path) => ({ path }))

const testCreds = {
  siteUrl: 'https://example.com',
  owner: 'acme',
  repo: 'site',
  branch: 'main',
  accessToken: 'ghs_test_token',
}

describe('GitHub source URL matching', () => {
  it('maps site root to root index.html (not a nested index)', () => {
    const hit = findBestGithubSourceMatch(autodunLikeTree, 'https://example.com/')
    expect(hit?.path).toBe('index.html')
  })

  it('maps /contact to public/contact/index.html directory indexes', () => {
    const hit = findBestGithubSourceMatch(autodunLikeTree, 'https://example.com/contact')
    expect(hit?.path).toBe('public/contact/index.html')
  })

  it('maps blog slug URLs to public/blog/*.html', () => {
    const hit = findBestGithubSourceMatch(
      autodunLikeTree,
      'https://example.com/blog/mot-cost-uk-2026',
    )
    expect(hit?.path).toBe('public/blog/mot-cost-uk-2026.html')
  })

  it('never selects .tsx component sources', () => {
    const hit = findBestGithubSourceMatch(autodunLikeTree, 'https://example.com/contact')
    expect(hit?.path).not.toMatch(/\.tsx$/)
  })
})

describe('isDirectPushBlocked', () => {
  it('treats 403/404/409/422 as blocked', () => {
    expect(isDirectPushBlocked(403, 'Resource not accessible by integration')).toBe(true)
    expect(isDirectPushBlocked(404, 'Not Found')).toBe(true)
    expect(isDirectPushBlocked(409, 'Conflict')).toBe(true)
    expect(isDirectPushBlocked(422, 'Validation Failed')).toBe(true)
  })

  it('detects protected-branch messages even on non-standard status', () => {
    expect(isDirectPushBlocked(500, 'Cannot update protected branch main')).toBe(true)
    expect(isDirectPushBlocked(500, 'Required status checks must pass')).toBe(true)
  })

  it('does not treat unrelated errors as blocked', () => {
    expect(isDirectPushBlocked(500, 'Internal Server Error')).toBe(false)
    expect(isDirectPushBlocked(401, 'Bad credentials')).toBe(false)
  })
})

describe('githubTokenKindHint', () => {
  it('labels App installation vs fine-grained vs classic tokens', () => {
    expect(githubTokenKindHint('ghs_abc')).toMatch(/github_app_installation/)
    expect(githubTokenKindHint('github_pat_abc')).toMatch(/fine_grained_pat/)
    expect(githubTokenKindHint('ghp_abc')).toMatch(/classic_pat/)
  })
})

describe('stale client Fix Agent branches', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('flags seoranko-fix-* and known merged homepage stubs', () => {
    expect(isStaleClientFixBranch('seoranko-fix-abc-itoi')).toBe(true)
    expect(isStaleClientFixBranch('homepage-build')).toBe(true)
    expect(isStaleClientFixBranch('claude/build-homepage-UAaZz')).toBe(true)
    expect(isStaleClientFixBranch('main')).toBe(false)
    expect(isStaleClientFixBranch('feature/something')).toBe(false)
  })

  it('deletes stale branches via GitHub API', async () => {
    const deleted: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method || 'GET').toUpperCase()
        if (method === 'GET' && url.includes('/branches')) {
          return new Response(
            JSON.stringify([
              { name: 'main' },
              { name: 'seoranko-fix-abc' },
              { name: 'homepage-build' },
              { name: 'keep-me' },
            ]),
            { status: 200 },
          )
        }
        if (method === 'DELETE' && url.includes('/git/refs/heads/')) {
          const branch = decodeURIComponent(url.split('/git/refs/heads/')[1] || '')
          deleted.push(branch)
          return new Response(null, { status: 204 })
        }
        throw new Error(`unexpected ${method} ${url}`)
      }),
    )

    const result = await deleteStaleSeorankoFixBranches(testCreds)
    expect(result.deleted.sort()).toEqual(['homepage-build', 'seoranko-fix-abc'].sort())
    expect(result.failed).toEqual([])
    expect(deleted).not.toContain('main')
    expect(deleted).not.toContain('keep-me')
  })
})

describe('GitHub writeStaticFile direct-push only', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fails with an explicit error when direct push returns 403 (no PR fallback)', async () => {
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> | string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method || 'GET').toUpperCase()
        let body: Record<string, unknown> | string | undefined
        if (init?.body && typeof init.body === 'string') {
          try {
            body = JSON.parse(init.body) as Record<string, unknown>
          } catch {
            body = init.body
          }
        }
        calls.push({ url, method, body })

        if (method === 'GET' && /\/git\/trees\//.test(url)) {
          return new Response(JSON.stringify({ tree: [] }), { status: 200 })
        }
        if (method === 'GET' && url.includes('/contents/')) {
          return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
        }
        const bodyObj = body && typeof body === 'object' ? body : undefined
        if (method === 'PUT' && url.includes('/contents/') && bodyObj?.branch === 'main') {
          return new Response(
            JSON.stringify({ message: 'Resource not accessible by integration' }),
            { status: 403 },
          )
        }
        if (method === 'POST' && url.endsWith('/pulls')) {
          throw new Error('must not open a PR when PR fallback is disabled')
        }
        if (method === 'POST' && url.endsWith('/git/refs')) {
          throw new Error('must not create a review branch when PR fallback is disabled')
        }
        return new Response(JSON.stringify({ message: `unexpected ${method} ${url}` }), {
          status: 500,
        })
      }),
    )

    const result = await githubAdapter.writeStaticFile!(
      testCreds,
      'llms.txt',
      '# hello\n',
      { commitMessage: 'SEORANKO Fix Agent: add llms.txt' },
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Direct push blocked/i)
    expect(result.error).toMatch(/PR fallback is disabled/i)
    expect(result.error).toMatch(/Resource not accessible by integration/i)
    expect(result.error).toMatch(/HTTP 403/)
    expect(result.error).toMatch(/token_kind=/)
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(false)
  })

  it('rewritePageHtml 403 also fails closed with no PR fallback', async () => {
    const calls: Array<{ url: string; method: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method || 'GET').toUpperCase()
        calls.push({ url, method })
        if (method === 'GET' && url.includes('/contents/')) {
          return new Response(
            JSON.stringify({
              content: Buffer.from('<html></html>', 'utf-8').toString('base64'),
              sha: 'abc',
            }),
            { status: 200 },
          )
        }
        if (method === 'PUT' && url.includes('/contents/')) {
          return new Response(
            JSON.stringify({ message: 'Resource not accessible by integration' }),
            { status: 403 },
          )
        }
        return new Response('unexpected', { status: 500 })
      }),
    )

    const result = await githubAdapter.rewritePageHtml!(
      testCreds,
      {
        id: 'public/about/index.html',
        url: 'https://example.com/about',
        title: 'About',
        bodyHtml: '<html></html>',
        hasSchema: false,
      },
      '<html><body>x</body></html>',
      { commitMessage: 'test' },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/PR fallback is disabled/i)
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(false)
  })

  it('adapter source has no PR-fallback helpers', () => {
    const src = readFileSync(join(__dirname, 'github-adapter.ts'), 'utf8')
    expect(src).not.toMatch(/async function createPullRequest/)
    expect(src).not.toMatch(/opens? a pull request/i)
    expect(src).toMatch(/PR fallback is disabled/)
  })

  it('marks direct-push success as awaiting deploy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method || 'GET').toUpperCase()
        if (method === 'GET' && /\/git\/trees\//.test(url)) {
          return new Response(JSON.stringify({ tree: [] }), { status: 200 })
        }
        if (method === 'GET' && url.includes('/contents/')) {
          return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
        }
        if (method === 'PUT' && url.includes('/contents/')) {
          return new Response(JSON.stringify({ content: { path: 'llms.txt' } }), { status: 201 })
        }
        return new Response('unexpected', { status: 500 })
      }),
    )

    const result = await githubAdapter.writeStaticFile!(testCreds, 'llms.txt', '# hello\n')

    expect(result.success).toBe(true)
    expect(result.pending).toBe(true)
    expect(result.pendingKind).toBe('deploy')
    expect(result.detail).toMatch(/Committed|Awaiting host rebuild/i)
  })

  it('link-href style rewrite with riskLevel safe direct-pushes when Contents write works', async () => {
    const puts: Array<Record<string, unknown> | undefined> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method || 'GET').toUpperCase()
        let body: Record<string, unknown> | undefined
        if (init?.body && typeof init.body === 'string') {
          try {
            body = JSON.parse(init.body) as Record<string, unknown>
          } catch {
            body = undefined
          }
        }
        if (method === 'GET' && url.includes('/contents/')) {
          return new Response(
            JSON.stringify({
              content: Buffer.from('<a href="/old">x</a>', 'utf-8').toString('base64'),
              sha: 'sha1',
              encoding: 'base64',
            }),
            { status: 200 },
          )
        }
        if (method === 'PUT' && url.includes('/contents/')) {
          puts.push(body)
          return new Response(JSON.stringify({ content: { path: 'public/blog/index.html' } }), {
            status: 201,
          })
        }
        if (method === 'POST' && url.endsWith('/pulls')) {
          throw new Error('must not open PR when direct push succeeds')
        }
        return new Response(JSON.stringify({ message: `unexpected ${method} ${url}` }), {
          status: 500,
        })
      }),
    )

    const result = await githubAdapter.rewritePageHtml!(
      testCreds,
      {
        id: 'public/blog/index.html',
        url: 'https://example.com/blog/',
        title: 'Blog',
        bodyHtml: '<a href="/old">x</a>',
        hasSchema: false,
      },
      '<a href="/new">x</a>',
      {
        riskLevel: 'safe',
        commitMessage: 'SEORANKO Fix Agent: rewrite 1 link href(s) on public/blog/index.html',
      },
    )

    expect(result.success).toBe(true)
    expect(result.pendingKind).toBe('deploy')
    expect(puts).toHaveLength(1)
    expect(puts[0]?.branch).toBe('main')
  })

  it('review-required riskLevel still direct-pushes (no PR path)', async () => {
    const puts: Array<Record<string, unknown> | undefined> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method || 'GET').toUpperCase()
        let body: Record<string, unknown> | undefined
        if (init?.body && typeof init.body === 'string') {
          try {
            body = JSON.parse(init.body) as Record<string, unknown>
          } catch {
            body = undefined
          }
        }
        if (method === 'GET' && url.includes('/contents/')) {
          return new Response(
            JSON.stringify({
              content: Buffer.from('<p>old</p>', 'utf-8').toString('base64'),
              sha: 'sha1',
              encoding: 'base64',
            }),
            { status: 200 },
          )
        }
        if (method === 'PUT' && url.includes('/contents/')) {
          puts.push(body)
          return new Response(JSON.stringify({ content: { path: 'public/about/index.html' } }), {
            status: 201,
          })
        }
        if (method === 'POST' && url.endsWith('/pulls')) {
          throw new Error('must not open PR for review-required')
        }
        return new Response(JSON.stringify({ message: `unexpected ${method} ${url}` }), {
          status: 500,
        })
      }),
    )

    const result = await githubAdapter.rewritePageHtml!(
      testCreds,
      {
        id: 'public/about/index.html',
        url: 'https://example.com/about/',
        title: 'About',
        bodyHtml: '<p>old</p>',
        hasSchema: false,
      },
      '<p>new</p>',
      { riskLevel: 'review-required', commitMessage: 'SEORANKO Fix Agent: update about' },
    )

    expect(result.success).toBe(true)
    expect(result.pendingKind).toBe('deploy')
    expect(puts).toHaveLength(1)
    expect(puts[0]?.branch).toBe('main')
  })
})

describe('Settings multi-CMS connect UI', () => {
  it('ConnectSiteModal exposes every supported platform, not only Universal Tag', () => {
    const src = readFileSync(join(__dirname, '../../components/ConnectSiteModal.tsx'), 'utf8')
    expect(src).toMatch(/github/)
    expect(src).toMatch(/wordpress/)
    expect(src).toMatch(/shopify/)
    expect(src).toMatch(/webflow/)
    expect(src).toMatch(/universal-tag/)
    expect(src).toMatch(/Connection type/)
    expect(src).toMatch(/Change connection|Switch to/)
    // No silent autodun-specific defaults in placeholders
    expect(src).not.toMatch(/placeholder: 'autodun/)
  })

  it('SitesManager wires Change connection with current cms_type', () => {
    const src = readFileSync(join(__dirname, '../../components/SitesManager.tsx'), 'utf8')
    expect(src).toMatch(/Change connection/)
    expect(src).toMatch(/currentCmsType/)
    expect(src).toMatch(/ConnectSiteModal/)
  })

  it('site-adapters registry still includes all five platforms', () => {
    const src = readFileSync(join(__dirname, './index.ts'), 'utf8')
    expect(src).toMatch(/wordpressAdapter/)
    expect(src).toMatch(/shopifyAdapter/)
    expect(src).toMatch(/webflowAdapter/)
    expect(src).toMatch(/githubAdapter/)
    expect(src).toMatch(/createUniversalTagAdapter/)
    expect(src).toMatch(/'github'/)
  })
})

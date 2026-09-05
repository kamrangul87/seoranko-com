import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  findBestGithubSourceMatch,
  isDirectPushBlocked,
  githubAdapter,
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

describe('GitHub writeStaticFile PR fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('opens seoranko-fix-* PR when direct push returns 403', async () => {
    const calls: Array<{ url: string; method: string; body?: any }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method || 'GET').toUpperCase()
        let body: any
        if (init?.body && typeof init.body === 'string') {
          try {
            body = JSON.parse(init.body)
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
        if (method === 'PUT' && url.includes('/contents/') && body?.branch === 'main') {
          return new Response(
            JSON.stringify({ message: 'Resource not accessible by integration' }),
            { status: 403 },
          )
        }
        if (method === 'GET' && /\/git\/ref\/heads\//.test(url)) {
          return new Response(JSON.stringify({ object: { sha: 'abc123base' } }), { status: 200 })
        }
        if (method === 'POST' && url.endsWith('/git/refs')) {
          expect(body.ref).toMatch(/^refs\/heads\/seoranko-fix-/)
          return new Response(JSON.stringify({ ref: body.ref }), { status: 201 })
        }
        if (
          method === 'PUT' &&
          url.includes('/contents/') &&
          String(body?.branch || '').startsWith('seoranko-fix-')
        ) {
          return new Response(JSON.stringify({ content: { path: 'llms.txt' } }), { status: 201 })
        }
        if (method === 'POST' && url.endsWith('/pulls')) {
          expect(body.head).toMatch(/^seoranko-fix-/)
          expect(body.base).toBe('main')
          return new Response(
            JSON.stringify({ html_url: 'https://github.com/acme/site/pull/42' }),
            { status: 201 },
          )
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

    expect(result.success).toBe(true)
    expect(result.pending).toBe(true)
    expect(result.pendingKind).toBe('merge')
    expect(result.url).toBe('https://github.com/acme/site/pull/42')
    expect(result.detail).toMatch(/Pull Request opened/i)
    expect(calls.some((c) => c.method === 'PUT' && c.body?.branch === 'main')).toBe(true)
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(true)
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

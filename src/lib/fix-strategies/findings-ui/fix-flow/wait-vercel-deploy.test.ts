/**
 * Preview discovery — GitHub Deployments + status/check-run/PR-comment fallbacks.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  checkPreviewOnce,
  previewUrlFromVercelBotComment,
  probePreviewAuth,
  PREVIEW_AUTH_BLOCKED_MESSAGE,
  waitForPrPreviewDeploy,
} from './wait-vercel-deploy'

const OWNER = 'acme'
const REPO = 'widget'
const BRANCH = 'seoranko/fix-run-widget-abc'
const SHA = '7b3f04ab073263293685b0a67b224c1562e3bbf8'
const PREVIEW = 'https://widget-cb33dqkht-team.vercel.app'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function refOk(): Response {
  return jsonResponse({ object: { sha: SHA } })
}

describe('previewUrlFromVercelBotComment', () => {
  it('reads previewUrl from encoded [vc] payload when DEPLOYED', () => {
    const payload = Buffer.from(
      JSON.stringify({
        projects: [
          {
            name: 'widget',
            previewUrl: 'widget-cb33dqkht-team.vercel.app',
            nextCommitStatus: 'DEPLOYED',
          },
        ],
      }),
      'utf8',
    ).toString('base64')
    const body = `[vc]: #abc=${payload}\n| [Preview](https://other.example) |`
    expect(previewUrlFromVercelBotComment(body)).toBe(PREVIEW)
  })

  it('falls back to markdown Preview link', () => {
    const body = `The latest updates\n\n| x | [Preview](${PREVIEW}/path) |`
    expect(previewUrlFromVercelBotComment(body)).toBe(PREVIEW)
  })
})

describe('checkPreviewOnce', () => {
  it('returns preview from GitHub deployment statuses when available', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/git/ref/heads/')) return refOk()
      if (url.includes('/deployments?sha=')) {
        return jsonResponse([
          {
            id: 99,
            sha: SHA,
            environment: 'Preview',
            production_environment: false,
            statuses_url: `${url.split('?')[0]}/99/statuses`,
          },
        ])
      }
      if (url.includes('/deployments/99/statuses')) {
        return jsonResponse([
          {
            state: 'success',
            environment_url: PREVIEW,
            target_url: PREVIEW,
          },
        ])
      }
      if (url.includes('/deployments?ref=')) return jsonResponse([])
      // Probe
      if (url.startsWith(PREVIEW)) return new Response('ok', { status: 200 })
      return jsonResponse({}, 404)
    }) as unknown as typeof fetch

    const once = await checkPreviewOnce({
      owner: OWNER,
      repo: REPO,
      branchName: BRANCH,
      accessToken: 't',
      prNumber: 1,
      fetchImpl,
    })
    expect(once.ok).toBe(true)
    if (!once.ok) return
    expect(once.previewUrl).toBe(PREVIEW)
    expect(once.source).toBe('github_deployment')
  })

  it('falls back to vercel[bot] PR comment when deployments return 403', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        projects: [
          {
            previewUrl: 'widget-cb33dqkht-team.vercel.app',
            nextCommitStatus: 'DEPLOYED',
          },
        ],
      }),
      'utf8',
    ).toString('base64')
    const commentBody = `[vc]: #sig=${payload}\nReady`

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/git/ref/heads/')) return refOk()
      if (url.includes('/deployments?')) {
        return jsonResponse({ message: 'Resource not accessible by integration' }, 403)
      }
      if (url.includes('/commits/') && url.endsWith('/statuses?per_page=100')) {
        return jsonResponse([
          {
            context: 'Vercel',
            state: 'success',
            // Inspector URL only — not a preview origin
            target_url: 'https://vercel.com/team/widget/dpl_abc',
          },
        ])
      }
      if (url.includes('/commits/') && url.endsWith('/status')) {
        return jsonResponse({ state: 'success', statuses: [] })
      }
      if (url.includes('/check-runs')) {
        return jsonResponse({ total_count: 0, check_runs: [] })
      }
      if (url.includes('/issues/1/comments')) {
        return jsonResponse([
          { id: 1, user: { login: 'vercel[bot]' }, body: commentBody },
        ])
      }
      if (url.startsWith(PREVIEW)) return new Response('<html>ok</html>', { status: 200 })
      return jsonResponse({}, 404)
    }) as unknown as typeof fetch

    const once = await checkPreviewOnce({
      owner: OWNER,
      repo: REPO,
      branchName: BRANCH,
      accessToken: 't',
      prNumber: 1,
      fetchImpl,
    })
    expect(once.ok).toBe(true)
    if (!once.ok) return
    expect(once.previewUrl).toBe(PREVIEW)
    expect(once.source).toBe('pr_comment')
  })

  it('falls back to commit status when target_url is a vercel.app host', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/git/ref/heads/')) return refOk()
      if (url.includes('/deployments?')) return jsonResponse([], 200)
      if (url.includes('/statuses?per_page=100')) {
        return jsonResponse([
          {
            context: 'Vercel',
            state: 'success',
            target_url: `${PREVIEW}/`,
          },
        ])
      }
      if (url.startsWith(PREVIEW)) return new Response('ok', { status: 200 })
      return jsonResponse({}, 404)
    }) as unknown as typeof fetch

    const once = await checkPreviewOnce({
      owner: OWNER,
      repo: REPO,
      branchName: BRANCH,
      accessToken: 't',
      fetchImpl,
      probeAuth: true,
    })
    expect(once.ok).toBe(true)
    if (!once.ok) return
    expect(once.source).toBe('commit_status')
    expect(once.previewUrl).toBe(PREVIEW)
  })

  it('fails hard with auth message when preview returns 401', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/git/ref/heads/')) return refOk()
      if (url.includes('/deployments?sha=')) {
        return jsonResponse([
          {
            id: 1,
            sha: SHA,
            environment: 'Preview',
            statuses_url: `https://api.github.com/repos/${OWNER}/${REPO}/deployments/1/statuses`,
          },
        ])
      }
      if (url.includes('/deployments/1/statuses')) {
        return jsonResponse([
          { state: 'success', environment_url: PREVIEW, target_url: PREVIEW },
        ])
      }
      if (url.includes('/deployments?ref=')) return jsonResponse([])
      if (url.startsWith(PREVIEW)) return new Response('login', { status: 401 })
      return jsonResponse({}, 404)
    }) as unknown as typeof fetch

    const once = await checkPreviewOnce({
      owner: OWNER,
      repo: REPO,
      branchName: BRANCH,
      accessToken: 't',
      fetchImpl,
    })
    expect(once.ok).toBe(false)
    if (once.ok) return
    expect(once.pending).toBe(false)
    expect(once.error).toBe(PREVIEW_AUTH_BLOCKED_MESSAGE)
  })

  it('reports deployments HTTP 403 as the missing signal when no fallback yields a URL', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/git/ref/heads/')) return refOk()
      if (url.includes('/deployments?')) {
        return jsonResponse({ message: 'Resource not accessible by integration' }, 403)
      }
      if (url.includes('/statuses')) return jsonResponse([])
      if (url.includes('/status')) return jsonResponse({ state: 'pending', statuses: [] })
      if (url.includes('/check-runs')) return jsonResponse({ check_runs: [] })
      if (url.includes('/comments')) return jsonResponse([])
      return jsonResponse({}, 404)
    }) as unknown as typeof fetch

    const once = await checkPreviewOnce({
      owner: OWNER,
      repo: REPO,
      branchName: BRANCH,
      accessToken: 't',
      prNumber: 1,
      fetchImpl,
    })
    expect(once.ok).toBe(false)
    if (once.ok) return
    expect(once.pending).toBe(true)
    expect(once.error).toMatch(/deployments_by_sha HTTP 403/)
  })
})

describe('waitForPrPreviewDeploy timeout copy', () => {
  it('fails with a plain missing-signal sentence after the bound', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/git/ref/heads/')) return refOk()
      if (url.includes('/deployments?')) return jsonResponse([], 200)
      if (url.includes('/statuses')) return jsonResponse([])
      if (url.includes('/status')) return jsonResponse({ statuses: [] })
      if (url.includes('/check-runs')) return jsonResponse({ check_runs: [] })
      if (url.includes('/comments')) return jsonResponse([])
      return jsonResponse({}, 404)
    }) as unknown as typeof fetch

    const result = await waitForPrPreviewDeploy({
      owner: OWNER,
      repo: REPO,
      branchName: BRANCH,
      accessToken: 't',
      prNumber: 1,
      timeoutMs: 30,
      pollMs: 10,
      fetchImpl,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.pending).toBe(false)
    expect(result.error).toMatch(/^No preview URL within 15 minutes — missing signal:/)
  })
})

describe('probePreviewAuth', () => {
  it('flags 403 as blocked', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 403 })) as unknown as typeof fetch
    const p = await probePreviewAuth(PREVIEW, fetchImpl)
    expect(p.blocked).toBe(true)
  })
})

describe('checkProductionDeployOnce', () => {
  it('returns ok when Production deployment status is success', async () => {
    const { checkProductionDeployOnce } = await import('./wait-vercel-deploy')
    const mergeSha = SHA
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/deployments?sha=')) {
        return jsonResponse([
          {
            id: 42,
            sha: mergeSha,
            environment: 'Production',
            production_environment: true,
            statuses_url: `https://api.github.com/repos/${OWNER}/${REPO}/deployments/42/statuses`,
          },
        ])
      }
      if (url.includes('/deployments/42/statuses')) {
        return jsonResponse([{ state: 'success', environment_url: PREVIEW }])
      }
      return jsonResponse({}, 404)
    }) as unknown as typeof fetch

    const once = await checkProductionDeployOnce({
      owner: OWNER,
      repo: REPO,
      mergeSha,
      accessToken: 't',
      fetchImpl,
    })
    expect(once.ok).toBe(true)
    if (!once.ok) return
    expect(once.source).toBe('github_deployment')
  })

  it('falls back to Vercel commit status when deployments return 403', async () => {
    const { checkProductionDeployOnce } = await import('./wait-vercel-deploy')
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/deployments?sha=')) {
        return jsonResponse({ message: 'Resource not accessible by integration' }, 403)
      }
      if (url.includes('/statuses?per_page=100')) {
        return jsonResponse([
          { context: 'Vercel', state: 'success', target_url: 'https://vercel.com/x/y' },
        ])
      }
      return jsonResponse({}, 404)
    }) as unknown as typeof fetch

    const once = await checkProductionDeployOnce({
      owner: OWNER,
      repo: REPO,
      mergeSha: SHA,
      accessToken: 't',
      fetchImpl,
    })
    expect(once.ok).toBe(true)
    if (!once.ok) return
    expect(once.source).toBe('commit_status')
  })
})

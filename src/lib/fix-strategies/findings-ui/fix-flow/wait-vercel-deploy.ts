/**
 * Wait for a Vercel (or GitHub) deployment of a PR branch, then return the
 * preview URL to verify against. Does not merge to main.
 */

export type DeployWaitResult =
  | {
      ok: true
      previewUrl: string
      deploymentId?: string
      state: string
      detail: string
    }
  | { ok: false; error: string; pending?: boolean }

type GhDeployment = {
  id: number
  environment?: string
  transient_environment?: boolean
  production_environment?: boolean
  statuses_url?: string
  created_at?: string
}

type GhStatus = {
  state?: string
  environment_url?: string
  target_url?: string
  description?: string
  created_at?: string
}

const GH = 'https://api.github.com'

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/**
 * Poll GitHub deployment statuses for the PR head SHA / branch until a
 * preview environment URL is ready (Vercel posts these).
 */
export async function waitForPrPreviewDeploy(input: {
  owner: string
  repo: string
  branchName: string
  accessToken: string
  /** Max wait ms (default 8 min). */
  timeoutMs?: number
  pollMs?: number
  fetchImpl?: typeof fetch
}): Promise<DeployWaitResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const timeoutMs = input.timeoutMs ?? 8 * 60 * 1000
  const pollMs = input.pollMs ?? 15_000
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    const once = await checkPreviewOnce({
      owner: input.owner,
      repo: input.repo,
      branchName: input.branchName,
      accessToken: input.accessToken,
      fetchImpl,
    })
    if (once.ok) return once
    if (!once.pending) return once
    await sleep(pollMs)
  }

  return {
    ok: false,
    pending: true,
    error: `Timed out after ${timeoutMs}ms waiting for preview deploy of ${input.branchName}`,
  }
}

export async function checkPreviewOnce(input: {
  owner: string
  repo: string
  branchName: string
  accessToken: string
  fetchImpl: typeof fetch
}): Promise<DeployWaitResult> {
  const { owner, repo, branchName, accessToken, fetchImpl } = input

  const refRes = await fetchImpl(
    `${GH}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branchName)}`,
    { headers: ghHeaders(accessToken), signal: AbortSignal.timeout(20000) },
  )
  if (!refRes.ok) {
    return {
      ok: false,
      pending: true,
      error: `Branch ref not found yet (HTTP ${refRes.status})`,
    }
  }
  const ref = (await refRes.json()) as { object?: { sha?: string } }
  const sha = ref.object?.sha
  if (!sha) {
    return { ok: false, pending: true, error: 'Branch SHA missing' }
  }

  const depRes = await fetchImpl(
    `${GH}/repos/${owner}/${repo}/deployments?sha=${sha}&per_page=10`,
    { headers: ghHeaders(accessToken), signal: AbortSignal.timeout(20000) },
  )
  if (!depRes.ok) {
    return {
      ok: false,
      pending: true,
      error: `Deployments list HTTP ${depRes.status}`,
    }
  }
  const deployments = (await depRes.json()) as GhDeployment[]
  if (!Array.isArray(deployments) || deployments.length === 0) {
    return {
      ok: false,
      pending: true,
      error: 'No GitHub deployments yet for this SHA (waiting for Vercel)',
    }
  }

  // Prefer non-production / preview environments
  const ordered = [...deployments].sort((a, b) => {
    const aProd = a.production_environment ? 1 : 0
    const bProd = b.production_environment ? 1 : 0
    return aProd - bProd
  })

  for (const d of ordered) {
    if (!d.statuses_url) continue
    const stRes = await fetchImpl(d.statuses_url, {
      headers: ghHeaders(accessToken),
      signal: AbortSignal.timeout(20000),
    })
    if (!stRes.ok) continue
    const statuses = (await stRes.json()) as GhStatus[]
    const success = statuses.find(
      (s) =>
        s.state === 'success' &&
        Boolean(s.environment_url || s.target_url),
    )
    if (success) {
      const previewUrl = (success.environment_url || success.target_url || '')
        .replace(/\/$/, '')
      if (!previewUrl) continue
      return {
        ok: true,
        previewUrl,
        deploymentId: String(d.id),
        state: 'success',
        detail: `Preview deploy ready: ${previewUrl}`,
      }
    }
    const inProgress = statuses.find((s) =>
      ['pending', 'in_progress', 'queued'].includes(String(s.state)),
    )
    if (inProgress) {
      return {
        ok: false,
        pending: true,
        error: `Deploy ${d.id} still ${inProgress.state}`,
      }
    }
  }

  return {
    ok: false,
    pending: true,
    error: 'Deployments present but no successful preview URL yet',
  }
}

/** Join preview origin with the page path from the production pageUrl. */
export function previewPageUrl(previewOrigin: string, productionPageUrl: string): string {
  let path = '/'
  try {
    path = new URL(productionPageUrl).pathname || '/'
  } catch {
    path = productionPageUrl.startsWith('/') ? productionPageUrl : `/${productionPageUrl}`
  }
  return `${previewOrigin.replace(/\/$/, '')}${path}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

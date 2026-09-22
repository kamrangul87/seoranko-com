/**
 * GitHub CI / check-run gate for findings auto-merge.
 * Requires real green evidence — zero checks is not "green".
 */

export type PrCiStatusResult =
  | { ok: true; detail: string; headSha: string }
  | { ok: false; pending?: boolean; detail: string; headSha?: string }

type GhJson = {
  ok: boolean
  status: number
  data: unknown
  text: string
}

async function ghJson(
  token: string,
  url: string,
  fetchImpl: typeof fetch,
  init?: RequestInit,
): Promise<GhJson> {
  const res = await fetchImpl(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    /* non-JSON */
  }
  return { ok: res.ok, status: res.status, data, text }
}

async function headShaForPr(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const pr = await ghJson(
    token,
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    fetchImpl,
  )
  if (!pr.ok) return null
  const sha = (pr.data as { head?: { sha?: string } })?.head?.sha
  return sha || null
}

/**
 * Poll combined commit status + check-runs until all are success, or fail.
 */
export async function waitForPrCiGreen(input: {
  owner: string
  repo: string
  prNumber: number
  accessToken: string
  timeoutMs?: number
  pollMs?: number
  fetchImpl?: typeof fetch
}): Promise<PrCiStatusResult> {
  const token = input.accessToken
  const fetchImpl = input.fetchImpl ?? fetch
  const timeoutMs = input.timeoutMs ?? 180_000
  const pollMs = input.pollMs ?? 5_000
  const started = Date.now()

  let headSha = await headShaForPr(
    token,
    input.owner,
    input.repo,
    input.prNumber,
    fetchImpl,
  )
  if (!headSha) {
    return {
      ok: false,
      detail: `Cannot read PR #${input.prNumber} head SHA`,
    }
  }

  while (Date.now() - started < timeoutMs) {
    headSha =
      (await headShaForPr(
        token,
        input.owner,
        input.repo,
        input.prNumber,
        fetchImpl,
      )) || headSha

    const status = await ghJson(
      token,
      `https://api.github.com/repos/${input.owner}/${input.repo}/commits/${headSha}/status`,
      fetchImpl,
    )
    const checks = await ghJson(
      token,
      `https://api.github.com/repos/${input.owner}/${input.repo}/commits/${headSha}/check-runs`,
      fetchImpl,
    )

    const combined =
      (status.data as { state?: string; statuses?: unknown[] }) || {}
    const checkRuns =
      (
        checks.data as {
          check_runs?: Array<{
            status: string
            conclusion: string | null
            name: string
          }>
        }
      )?.check_runs || []

    const statusContexts = Array.isArray(combined.statuses)
      ? combined.statuses.length
      : 0
    const hasAnyEvidence = statusContexts > 0 || checkRuns.length > 0

    if (!hasAnyEvidence) {
      if (Date.now() - started + pollMs >= timeoutMs) {
        return {
          ok: false,
          headSha,
          detail:
            'No CI check-runs or status contexts on the PR head — auto-merge requires CI green evidence',
        }
      }
      await sleep(pollMs)
      continue
    }

    const pendingChecks = checkRuns.filter((c) => c.status !== 'completed')
    const failedChecks = checkRuns.filter(
      (c) =>
        c.status === 'completed' &&
        c.conclusion != null &&
        !['success', 'neutral', 'skipped'].includes(c.conclusion),
    )
    const combinedState = combined.state || 'pending'

    if (
      failedChecks.length > 0 ||
      combinedState === 'failure' ||
      combinedState === 'error'
    ) {
      return {
        ok: false,
        headSha,
        detail: `CI failed on ${headSha}: combined=${combinedState}; failed=[${failedChecks
          .map((c) => c.name)
          .join(', ')}]`,
      }
    }

    const checksGreen =
      checkRuns.length === 0 ||
      (pendingChecks.length === 0 &&
        checkRuns.every(
          (c) =>
            c.conclusion == null ||
            ['success', 'neutral', 'skipped'].includes(c.conclusion),
        ))
    const statusGreen =
      statusContexts === 0 || combinedState === 'success'

    if (checksGreen && statusGreen) {
      return {
        ok: true,
        headSha,
        detail: `CI green on ${headSha} (statuses=${statusContexts}, checks=${checkRuns.length})`,
      }
    }

    await sleep(pollMs)
  }

  return {
    ok: false,
    pending: true,
    headSha,
    detail: `Timed out waiting for CI green on PR #${input.prNumber}`,
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function listPullRequestFiles(input: {
  owner: string
  repo: string
  prNumber: number
  accessToken: string
  fetchImpl?: typeof fetch
}): Promise<string[]> {
  const fetchImpl = input.fetchImpl ?? fetch
  const res = await ghJson(
    input.accessToken,
    `https://api.github.com/repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/files?per_page=100`,
    fetchImpl,
  )
  if (!res.ok || !Array.isArray(res.data)) return []
  return (res.data as Array<{ filename?: string }>)
    .map((f) => f.filename || '')
    .filter(Boolean)
}

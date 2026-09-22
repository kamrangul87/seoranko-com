/**
 * Merge / revert helpers for findings auto-merge.
 * Only called after every auto-merge gate holds.
 */

import type { GithubPrCreds } from './github-pr-commit'

type GhJson<T> = { ok: boolean; status: number; data: T; text: string }

async function ghJson<T>(
  token: string,
  url: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<GhJson<T>> {
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
  let data = {} as T
  try {
    data = text ? (JSON.parse(text) as T) : ({} as T)
  } catch {
    /* non-JSON */
  }
  return { ok: res.ok, status: res.status, data, text }
}

export type MergePrResult =
  | { ok: true; mergeSha: string; mergedAt: string }
  | { ok: false; error: string }

/** Merge a customer-repo PR (squash=false — use merge commit for clean revert). */
export async function mergePullRequest(input: {
  creds: GithubPrCreds
  prNumber: number
  commitTitle?: string
  fetchImpl?: typeof fetch
}): Promise<MergePrResult> {
  const { requireActiveCustomerWriteGate } = await import(
    '@/lib/customer-write-gate'
  )
  requireActiveCustomerWriteGate('findings.mergePullRequest')

  const { owner, repo, accessToken } = input.creds
  const fetchImpl = input.fetchImpl ?? fetch
  const res = await ghJson<{ sha?: string; merged?: boolean; message?: string }>(
    accessToken,
    `https://api.github.com/repos/${owner}/${repo}/pulls/${input.prNumber}/merge`,
    {
      method: 'PUT',
      body: JSON.stringify({
        merge_method: 'merge',
        commit_title: input.commitTitle,
      }),
    },
    fetchImpl,
  )
  if (!res.ok || !res.data.sha) {
    return {
      ok: false,
      error: `Merge failed for PR #${input.prNumber}: ${res.text.slice(0, 400)}`,
    }
  }
  return {
    ok: true,
    mergeSha: res.data.sha,
    mergedAt: new Date().toISOString(),
  }
}

export type RevertPrResult =
  | { ok: true; prUrl: string; prNumber: number; branchName: string }
  | { ok: false; error: string }

/**
 * Open a revert PR that restores the single file to its pre-merge content.
 * Used when production verify fails after auto-merge — do not leave a bad fix live.
 */
export async function openRevertPullRequest(input: {
  creds: GithubPrCreds
  /** Original fix PR number (to read merge commit + files). */
  originalPrNumber: number
  /** Repo-relative path that was changed (single-file). */
  path: string
  reason: string
  fetchImpl?: typeof fetch
}): Promise<RevertPrResult> {
  const { requireActiveCustomerWriteGate } = await import(
    '@/lib/customer-write-gate'
  )
  requireActiveCustomerWriteGate('findings.openRevertPullRequest')

  const { owner, repo, accessToken } = input.creds
  const base = input.creds.baseBranch || 'main'
  const fetchImpl = input.fetchImpl ?? fetch

  const pr = await ghJson<{
    merge_commit_sha?: string | null
    title?: string
    html_url?: string
  }>(
    accessToken,
    `https://api.github.com/repos/${owner}/${repo}/pulls/${input.originalPrNumber}`,
    undefined,
    fetchImpl,
  )
  if (!pr.ok) {
    return {
      ok: false,
      error: `Cannot read PR #${input.originalPrNumber} for revert`,
    }
  }
  const mergeSha = pr.data.merge_commit_sha
  if (!mergeSha) {
    return {
      ok: false,
      error: `PR #${input.originalPrNumber} has no merge_commit_sha — cannot revert`,
    }
  }

  const mergeCommit = await ghJson<{
    parents?: Array<{ sha: string }>
  }>(
    accessToken,
    `https://api.github.com/repos/${owner}/${repo}/git/commits/${mergeSha}`,
    undefined,
    fetchImpl,
  )
  const parentSha = mergeCommit.data.parents?.[0]?.sha
  if (!mergeCommit.ok || !parentSha) {
    return {
      ok: false,
      error: `Cannot resolve parent of merge commit ${mergeSha}`,
    }
  }

  const encodedPath = input.path
    .split('/')
    .map(encodeURIComponent)
    .join('/')
  const prior = await ghJson<{ content?: string; sha?: string; encoding?: string }>(
    accessToken,
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(parentSha)}`,
    undefined,
    fetchImpl,
  )
  if (!prior.ok || !prior.data.content) {
    return {
      ok: false,
      error: `Cannot read pre-merge ${input.path} at ${parentSha}`,
    }
  }

  const baseRef = await ghJson<{ object?: { sha?: string } }>(
    accessToken,
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`,
    undefined,
    fetchImpl,
  )
  if (!baseRef.ok || !baseRef.data.object?.sha) {
    return { ok: false, error: `Cannot read base branch ${base}` }
  }

  const branchName = `seoranko/revert-${input.originalPrNumber}-${Date.now().toString(36)}`
  const createRef = await ghJson(
    accessToken,
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseRef.data.object.sha,
      }),
    },
    fetchImpl,
  )
  if (!createRef.ok && createRef.status !== 422) {
    return {
      ok: false,
      error: `Cannot create revert branch: ${createRef.text.slice(0, 300)}`,
    }
  }

  // Current file sha on the new branch (post-merge tip).
  const current = await ghJson<{ sha?: string }>(
    accessToken,
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branchName)}`,
    undefined,
    fetchImpl,
  )
  if (!current.ok || !current.data.sha) {
    return {
      ok: false,
      error: `Cannot read ${input.path} on revert branch`,
    }
  }

  const put = await ghJson(
    accessToken,
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message: `revert: restore ${input.path} after failed production verify (PR #${input.originalPrNumber})`,
        content: prior.data.content,
        sha: current.data.sha,
        branch: branchName,
      }),
    },
    fetchImpl,
  )
  if (!put.ok) {
    return {
      ok: false,
      error: `Revert commit failed: ${put.text.slice(0, 400)}`,
    }
  }

  const opened = await ghJson<{ html_url?: string; number?: number }>(
    accessToken,
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: `REVERT: production verify failed after auto-merge of #${input.originalPrNumber}`,
        head: branchName,
        base,
        body: [
          '## 🚨 Human attention required',
          '',
          'SEORANKO auto-merged a findings fix, then **production verify failed**.',
          'This PR restores the pre-merge file contents. Please review and merge promptly — do not leave the failed fix live.',
          '',
          `- Original PR: #${input.originalPrNumber}`,
          `- File: \`${input.path}\``,
          `- Reason: ${input.reason}`,
          '',
          'Auto-merge remains opt-in (`auto_merge_enabled`); this revert still needs a **human** merge.',
        ].join('\n'),
      }),
    },
    fetchImpl,
  )
  if (!opened.ok || !opened.data.html_url || opened.data.number == null) {
    return {
      ok: false,
      error: `Revert branch committed but PR open failed: ${opened.text.slice(0, 400)}`,
    }
  }

  return {
    ok: true,
    prUrl: opened.data.html_url,
    prNumber: opened.data.number,
    branchName,
  }
}

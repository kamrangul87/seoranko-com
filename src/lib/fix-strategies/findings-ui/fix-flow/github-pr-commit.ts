/**
 * Findings fix-flow: commit an HTML fix on a review branch and open a PR.
 * Never pushes to the default branch (main/master).
 */

export type GithubPrCreds = {
  owner: string
  repo: string
  /** Base branch to branch from (default main). */
  baseBranch?: string
  accessToken: string
}

export type CommitViaPrInput = {
  creds: GithubPrCreds
  /** Repo-relative file path (e.g. public/blog/foo.html). */
  path: string
  newContent: string
  branchName: string
  commitMessage: string
  prTitle: string
  prBody: string
}

export type CommitViaPrResult =
  | {
      ok: true
      branchName: string
      commitSha: string
      prUrl: string
      prNumber: number
      skipped?: boolean
    }
  | { ok: false; error: string }

const GH = 'https://api.github.com'

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

async function ghJson<T>(
  token: string,
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T; text: string }> {
  const res = await fetch(url, {
    ...init,
    headers: { ...ghHeaders(token), ...(init?.headers ?? {}) },
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

/**
 * Create (or reuse) a branch from base, put file contents on that branch only,
 * open a PR into the default/base branch. Never writes to base/main.
 */
export async function commitFileViaPullRequest(
  input: CommitViaPrInput,
): Promise<CommitViaPrResult> {
  const { creds, path, newContent, branchName, commitMessage, prTitle, prBody } =
    input
  const token = creds.accessToken
  const owner = creds.owner
  const repo = creds.repo
  const baseBranch = creds.baseBranch || 'main'

  const repoInfo = await ghJson<{ default_branch?: string }>(
    token,
    `${GH}/repos/${owner}/${repo}`,
  )
  if (!repoInfo.ok) {
    return {
      ok: false,
      error: `Cannot access ${owner}/${repo} (HTTP ${repoInfo.status})`,
    }
  }
  const base = baseBranch || repoInfo.data.default_branch || 'main'

  const baseRef = await ghJson<{ object?: { sha?: string } }>(
    token,
    `${GH}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`,
  )
  if (!baseRef.ok || !baseRef.data.object?.sha) {
    return {
      ok: false,
      error: `Cannot read base branch ${base} (HTTP ${baseRef.status})`,
    }
  }
  const baseSha = baseRef.data.object.sha

  // Create branch; 422 means it already exists — reuse.
  const createRef = await ghJson<{ ref?: string }>(
    token,
    `${GH}/repos/${owner}/${repo}/git/refs`,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    },
  )
  if (
    !createRef.ok &&
    createRef.status !== 422 &&
    !/already exists/i.test(createRef.text)
  ) {
    return {
      ok: false,
      error: `Cannot create branch ${branchName}: ${createRef.text.slice(0, 300)}`,
    }
  }

  // Read current file on the *branch* (or base if new).
  const fileRes = await ghJson<{
    content?: string
    sha?: string
    encoding?: string
  }>(
    token,
    `${GH}/repos/${owner}/${repo}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?ref=${encodeURIComponent(branchName)}`,
  )
  if (!fileRes.ok || !fileRes.data.sha) {
    return {
      ok: false,
      error: `Cannot read ${path} on ${branchName} (HTTP ${fileRes.status})`,
    }
  }
  const current = Buffer.from(fileRes.data.content ?? '', 'base64').toString(
    'utf-8',
  )
  if (current === newContent) {
    // Still ensure a PR exists for the branch.
    const existing = await findOpenPr(token, owner, repo, branchName, base)
    if (existing) {
      return {
        ok: true,
        branchName,
        commitSha: baseSha,
        prUrl: existing.html_url,
        prNumber: existing.number,
        skipped: true,
      }
    }
  }

  const put = await ghJson<{
    commit?: { sha?: string }
    content?: { sha?: string }
  }>(token, `${GH}/repos/${owner}/${repo}/contents/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: commitMessage,
      content: Buffer.from(newContent, 'utf-8').toString('base64'),
      sha: fileRes.data.sha,
      branch: branchName,
    }),
  })
  if (!put.ok) {
    return {
      ok: false,
      error: `Commit failed on ${branchName}: ${put.text.slice(0, 400)}`,
    }
  }
  const commitSha =
    put.data.commit?.sha || put.data.content?.sha || 'unknown'

  const existingPr = await findOpenPr(token, owner, repo, branchName, base)
  if (existingPr) {
    return {
      ok: true,
      branchName,
      commitSha,
      prUrl: existingPr.html_url,
      prNumber: existingPr.number,
    }
  }

  const pr = await ghJson<{ html_url?: string; number?: number; message?: string }>(
    token,
    `${GH}/repos/${owner}/${repo}/pulls`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: prTitle,
        body: prBody,
        head: branchName,
        base,
        draft: false,
      }),
    },
  )
  if (!pr.ok || !pr.data.html_url || pr.data.number == null) {
    return {
      ok: false,
      error: `Branch committed but PR open failed: ${pr.text.slice(0, 400)}`,
    }
  }

  return {
    ok: true,
    branchName,
    commitSha,
    prUrl: pr.data.html_url,
    prNumber: pr.data.number,
  }
}

async function findOpenPr(
  token: string,
  owner: string,
  repo: string,
  head: string,
  base: string,
): Promise<{ html_url: string; number: number } | null> {
  const q = await ghJson<Array<{ html_url: string; number: number }>>(
    token,
    `${GH}/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(
      `${owner}:${head}`,
    )}&base=${encodeURIComponent(base)}`,
  )
  if (!q.ok || !Array.isArray(q.data) || q.data.length === 0) return null
  return q.data[0]!
}

/**
 * Resolve GitHub copy credentials for findings fix-flow.
 * Prefer site_connections; fall back to env tokens with explicit owner/repo
 * (operator E2E only — never a silent product default to one brand).
 */
export function resolveGithubCredsFromEnv(input: {
  owner: string
  repo: string
  baseBranch?: string
}): GithubPrCreds | null {
  const token =
    process.env.AUTODUN_GITHUB_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.FINDINGS_FIX_GITHUB_TOKEN?.trim() ||
    ''
  if (!token || !input.owner || !input.repo) return null
  return {
    owner: input.owner,
    repo: input.repo,
    baseBranch: input.baseBranch || 'main',
    accessToken: token,
  }
}

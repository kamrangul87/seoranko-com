/**
 * Injectable GitHub ops for one-run Fix Agent.
 * Production uses the Contents API; tests inject FixtureGithubRepo.
 */

export type GithubPrCreds = {
  owner: string
  repo: string
  baseBranch?: string
  accessToken: string
}

export type GithubOps = {
  createBranch(input: {
    creds: GithubPrCreds
    branchName: string
  }): Promise<{ ok: true; baseSha: string } | { ok: false; error: string }>

  readFile(input: {
    creds: GithubPrCreds
    path: string
    ref: string
  }): Promise<{ ok: true; content: string; sha: string } | { ok: false; error: string }>

  commitFile(input: {
    creds: GithubPrCreds
    path: string
    content: string
    branchName: string
    message: string
  }): Promise<{ ok: true; commitSha: string } | { ok: false; error: string }>

  /**
   * Restore file content from before a commit (partial-failure isolation).
   * Does not remove the failed commit from history — adds a revert commit.
   */
  revertFileCommit(input: {
    creds: GithubPrCreds
    path: string
    branchName: string
    /** Content to restore (pre-failed-commit). */
    previousContent: string
    message: string
  }): Promise<{ ok: true; commitSha: string } | { ok: false; error: string }>

  ensurePullRequest(input: {
    creds: GithubPrCreds
    branchName: string
    title: string
    body: string
  }): Promise<
    | { ok: true; prNumber: number; prUrl: string }
    | { ok: false; error: string }
  >

  mergePullRequest(input: {
    creds: GithubPrCreds
    prNumber: number
  }): Promise<{ ok: true; mergeSha: string } | { ok: false; error: string }>

  /** Optional: wait for preview URL. Tests return immediately. */
  waitForPreview?(input: {
    creds: GithubPrCreds
    prNumber: number
    pagePath?: string
  }): Promise<{ ok: true; previewUrl: string } | { ok: false; error: string }>
}

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

export function createLiveGithubOps(): GithubOps {
  return {
    async createBranch({ creds, branchName }) {
      const { requireActiveCustomerWriteGate } = await import(
        '@/lib/customer-write-gate'
      )
      requireActiveCustomerWriteGate('fix-run.createBranch')
      const token = creds.accessToken
      const base = creds.baseBranch || 'main'
      const baseRef = await ghJson<{ object?: { sha?: string } }>(
        token,
        `${GH}/repos/${creds.owner}/${creds.repo}/git/ref/heads/${encodeURIComponent(base)}`,
      )
      if (!baseRef.ok || !baseRef.data.object?.sha) {
        return {
          ok: false,
          error: `Cannot read base branch ${base} (HTTP ${baseRef.status})`,
        }
      }
      const baseSha = baseRef.data.object.sha
      const createRef = await ghJson(
        token,
        `${GH}/repos/${creds.owner}/${creds.repo}/git/refs`,
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
      return { ok: true, baseSha }
    },

    async readFile({ creds, path, ref }) {
      const token = creds.accessToken
      const encoded = path.split('/').map(encodeURIComponent).join('/')
      const fileRes = await ghJson<{
        content?: string
        sha?: string
      }>(
        token,
        `${GH}/repos/${creds.owner}/${creds.repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
      )
      if (!fileRes.ok || !fileRes.data.sha) {
        return {
          ok: false,
          error: `Cannot read ${path} @ ${ref} (HTTP ${fileRes.status})`,
        }
      }
      const content = Buffer.from(fileRes.data.content ?? '', 'base64').toString(
        'utf-8',
      )
      return { ok: true, content, sha: fileRes.data.sha }
    },

    async commitFile({ creds, path, content, branchName, message }) {
      const { requireActiveCustomerWriteGate } = await import(
        '@/lib/customer-write-gate'
      )
      requireActiveCustomerWriteGate('fix-run.commitFile')
      const token = creds.accessToken
      const encoded = path.split('/').map(encodeURIComponent).join('/')
      const current = await this.readFile({ creds, path, ref: branchName })
      if (!current.ok) return current
      if (current.content === content) {
        return { ok: true, commitSha: current.sha }
      }
      const put = await ghJson<{ commit?: { sha?: string } }>(
        token,
        `${GH}/repos/${creds.owner}/${creds.repo}/contents/${encoded}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            message,
            content: Buffer.from(content, 'utf-8').toString('base64'),
            sha: current.sha,
            branch: branchName,
          }),
        },
      )
      if (!put.ok) {
        return {
          ok: false,
          error: `Commit failed: ${put.text.slice(0, 400)}`,
        }
      }
      return {
        ok: true,
        commitSha: put.data.commit?.sha || 'unknown',
      }
    },

    async revertFileCommit({ creds, path, branchName, previousContent, message }) {
      return this.commitFile({
        creds,
        path,
        content: previousContent,
        branchName,
        message,
      })
    },

    async ensurePullRequest({ creds, branchName, title, body }) {
      const { requireActiveCustomerWriteGate } = await import(
        '@/lib/customer-write-gate'
      )
      requireActiveCustomerWriteGate('fix-run.ensurePullRequest')
      const token = creds.accessToken
      const base = creds.baseBranch || 'main'
      const existing = await ghJson<
        Array<{ html_url: string; number: number }>
      >(
        token,
        `${GH}/repos/${creds.owner}/${creds.repo}/pulls?state=open&head=${encodeURIComponent(
          `${creds.owner}:${branchName}`,
        )}&base=${encodeURIComponent(base)}`,
      )
      if (existing.ok && Array.isArray(existing.data) && existing.data[0]) {
        return {
          ok: true,
          prNumber: existing.data[0].number,
          prUrl: existing.data[0].html_url,
        }
      }
      const pr = await ghJson<{ html_url?: string; number?: number }>(
        token,
        `${GH}/repos/${creds.owner}/${creds.repo}/pulls`,
        {
          method: 'POST',
          body: JSON.stringify({
            title,
            body,
            head: branchName,
            base,
            draft: false,
          }),
        },
      )
      if (!pr.ok || !pr.data.html_url || pr.data.number == null) {
        return {
          ok: false,
          error: `PR open failed: ${pr.text.slice(0, 400)}`,
        }
      }
      return { ok: true, prNumber: pr.data.number, prUrl: pr.data.html_url }
    },

    async mergePullRequest({ creds, prNumber }) {
      const { requireActiveCustomerWriteGate } = await import(
        '@/lib/customer-write-gate'
      )
      requireActiveCustomerWriteGate('fix-run.mergePullRequest')
      const token = creds.accessToken
      const res = await ghJson<{ sha?: string }>(
        token,
        `${GH}/repos/${creds.owner}/${creds.repo}/pulls/${prNumber}/merge`,
        {
          method: 'PUT',
          body: JSON.stringify({ merge_method: 'merge' }),
        },
      )
      if (!res.ok) {
        return { ok: false, error: `Merge failed: ${res.text.slice(0, 400)}` }
      }
      return { ok: true, mergeSha: res.data.sha || 'merged' }
    },
  }
}

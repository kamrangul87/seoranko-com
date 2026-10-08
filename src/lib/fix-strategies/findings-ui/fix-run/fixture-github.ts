/**
 * In-memory GitHub fixture for one-run Fix Agent acceptance tests.
 * Simulates branch + multi-commit + single PR + merge + preview URLs.
 */

import type { GithubOps, GithubPrCreds } from './github-ops'

type FileMap = Map<string, string>

export type FixtureGithubRepo = {
  ops: GithubOps
  /** Live production files (base). */
  production: FileMap
  /** Branch tips: branchName → files. */
  branches: Map<string, FileMap>
  /** Commit log per branch: sha + path + content. */
  commits: Map<string, Array<{ sha: string; path: string; content: string; message: string }>>
  prs: Map<
    number,
    {
      number: number
      url: string
      branch: string
      merged: boolean
      mergeSha: string | null
    }
  >
  nextSha: number
  /** Forced fail on next commit for a path (partial-failure tests). */
  failNextCommitForPath: string | null
  /** Preview HTML override by page path after "deploy". */
  previewContent: Map<string, string>
  productionContent: Map<string, string>
}

function cloneMap(m: FileMap): FileMap {
  return new Map(m)
}

export function createFixtureGithubRepo(
  initialFiles: Record<string, string>,
): FixtureGithubRepo {
  const production = new Map(Object.entries(initialFiles))
  const state: FixtureGithubRepo = {
    production,
    branches: new Map(),
    commits: new Map(),
    prs: new Map(),
    nextSha: 1,
    failNextCommitForPath: null,
    previewContent: new Map(),
    productionContent: new Map(production),
    ops: null as unknown as GithubOps,
  }

  const sha = () => `sha${state.nextSha++}`

  const ops: GithubOps = {
    async createBranch({ branchName }) {
      if (!state.branches.has(branchName)) {
        state.branches.set(branchName, cloneMap(state.production))
        state.commits.set(branchName, [])
      }
      return { ok: true, baseSha: 'base' }
    },

    async readFile({ path, ref }) {
      const files =
        ref === 'main' || ref === 'master'
          ? state.production
          : state.branches.get(ref)
      if (!files || !files.has(path)) {
        return { ok: false, error: `File not found: ${path} @ ${ref}` }
      }
      return { ok: true, content: files.get(path)!, sha: `blob-${path}-${ref}` }
    },

    async commitFile({ path, content, branchName, message }) {
      if (state.failNextCommitForPath === path) {
        state.failNextCommitForPath = null
        return { ok: false, error: `Forced fixture failure for ${path}` }
      }
      let files = state.branches.get(branchName)
      if (!files) {
        files = cloneMap(state.production)
        state.branches.set(branchName, files)
        state.commits.set(branchName, [])
      }
      files.set(path, content)
      const commitSha = sha()
      state.commits.get(branchName)!.push({ sha: commitSha, path, content, message })
      // Preview deploy mirrors branch tip for this path
      state.previewContent.set(path, content)
      return { ok: true, commitSha }
    },

    async revertFileCommit({ path, branchName, previousContent, message }) {
      return this.commitFile({
        creds: { owner: 'o', repo: 'r', accessToken: 't' },
        path,
        content: previousContent,
        branchName,
        message,
      })
    },

    async ensurePullRequest({ branchName }) {
      for (const pr of state.prs.values()) {
        if (pr.branch === branchName && !pr.merged) {
          return { ok: true, prNumber: pr.number, prUrl: pr.url }
        }
      }
      const number = state.prs.size + 1
      const url = `https://github.com/fixture/repo/pull/${number}`
      state.prs.set(number, {
        number,
        url,
        branch: branchName,
        merged: false,
        mergeSha: null,
      })
      return { ok: true, prNumber: number, prUrl: url }
    },

    async mergePullRequest({ prNumber }) {
      const pr = state.prs.get(prNumber)
      if (!pr) return { ok: false, error: 'PR not found' }
      const files = state.branches.get(pr.branch)
      if (files) {
        for (const [path, content] of files) {
          state.production.set(path, content)
          state.productionContent.set(path, content)
        }
      }
      const mergeSha = sha()
      pr.merged = true
      pr.mergeSha = mergeSha
      return { ok: true, mergeSha }
    },

    async waitForPreview({ prNumber }) {
      const pr = state.prs.get(prNumber)
      if (!pr) return { ok: false, error: 'PR not found' }
      // Non-example host so production placeholder guards stay meaningful.
      return {
        ok: true,
        previewUrl: `https://fix-run-preview.test/pr-${prNumber}`,
      }
    },
  }

  state.ops = ops
  return state
}

/** Dummy creds for fixture ops. */
export const FIXTURE_CREDS: GithubPrCreds = {
  owner: 'fixture',
  repo: 'repo',
  baseBranch: 'main',
  accessToken: 'fixture-token',
}

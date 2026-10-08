/**
 * Reset kamrangul87/seoranko-fixture main to the seed branch tree.
 * Creates a new commit on main with the seed tree (parent = current main tip).
 * Never force-pushes unrelated repos.
 */

import {
  E2E_FIXTURE_OWNER,
  E2E_FIXTURE_REPO,
  E2E_SEED_BRANCH,
} from './constants'

const GH = 'https://api.github.com'

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

async function ghJson<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T; text: string }> {
  const res = await fetch(`${GH}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init?.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  let data = {} as T
  try {
    data = text ? (JSON.parse(text) as T) : ({} as T)
  } catch {
    /* */
  }
  return { ok: res.ok, status: res.status, data, text }
}

export type ResetSeedResult =
  | { ok: true; seedSha: string; mainSha: string; detail: string }
  | { ok: false; error: string }

/**
 * Point main at a new commit whose tree equals the seed branch tip.
 * If main already equals seed tip, no-op success.
 */
export async function resetFixtureMainToSeed(input: {
  accessToken: string
  owner?: string
  repo?: string
  seedBranch?: string
}): Promise<ResetSeedResult> {
  const owner = input.owner || E2E_FIXTURE_OWNER
  const repo = input.repo || E2E_FIXTURE_REPO
  const seedBranch = input.seedBranch || E2E_SEED_BRANCH
  const token = input.accessToken

  const seedRef = await ghJson<{ object?: { sha?: string } }>(
    token,
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(seedBranch)}`,
  )
  if (!seedRef.ok || !seedRef.data.object?.sha) {
    return {
      ok: false,
      error: `seed branch ${seedBranch} not found (HTTP ${seedRef.status})`,
    }
  }
  const seedSha = seedRef.data.object.sha

  const mainRef = await ghJson<{ object?: { sha?: string } }>(
    token,
    `/repos/${owner}/${repo}/git/ref/heads/main`,
  )
  if (!mainRef.ok || !mainRef.data.object?.sha) {
    return {
      ok: false,
      error: `main branch not found (HTTP ${mainRef.status})`,
    }
  }
  const mainSha = mainRef.data.object.sha

  if (mainSha === seedSha) {
    return {
      ok: true,
      seedSha,
      mainSha,
      detail: 'main already at seed tip',
    }
  }

  const seedCommit = await ghJson<{
    tree?: { sha?: string }
    message?: string
  }>(token, `/repos/${owner}/${repo}/git/commits/${seedSha}`)
  if (!seedCommit.ok || !seedCommit.data.tree?.sha) {
    return { ok: false, error: `Cannot read seed commit ${seedSha.slice(0, 7)}` }
  }
  const treeSha = seedCommit.data.tree.sha

  // Fast-forward if seed contains main as ancestor (seed ahead of main).
  const compare = await ghJson<{ status?: string; ahead_by?: number }>(
    token,
    `/repos/${owner}/${repo}/compare/${mainSha}...${seedSha}`,
  )
  if (compare.ok && compare.data.status === 'ahead') {
    const ff = await ghJson<{ object?: { sha?: string } }>(
      token,
      `/repos/${owner}/${repo}/git/refs/heads/main`,
      {
        method: 'PATCH',
        body: JSON.stringify({ sha: seedSha, force: false }),
      },
    )
    if (ff.ok) {
      return {
        ok: true,
        seedSha,
        mainSha: seedSha,
        detail: `fast-forwarded main to seed ${seedSha.slice(0, 7)}`,
      }
    }
  }

  // Otherwise: new commit on main with seed tree (reset commit, not force).
  const created = await ghJson<{ sha?: string }>(
    token,
    `/repos/${owner}/${repo}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({
        message: `e2e: reset main to seed ${seedSha.slice(0, 7)}`,
        tree: treeSha,
        parents: [mainSha],
      }),
    },
  )
  if (!created.ok || !created.data.sha) {
    return {
      ok: false,
      error: `Create reset commit failed (HTTP ${created.status}): ${created.text.slice(0, 200)}`,
    }
  }

  const update = await ghJson(
    token,
    `/repos/${owner}/${repo}/git/refs/heads/main`,
    {
      method: 'PATCH',
      body: JSON.stringify({ sha: created.data.sha, force: false }),
    },
  )
  if (!update.ok) {
    return {
      ok: false,
      error: `Update main ref failed (HTTP ${update.status}): ${update.text.slice(0, 200)}`,
    }
  }

  return {
    ok: true,
    seedSha,
    mainSha: created.data.sha,
    detail: `reset-commit ${created.data.sha.slice(0, 7)} (tree from seed ${seedSha.slice(0, 7)})`,
  }
}

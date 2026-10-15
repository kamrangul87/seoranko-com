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

type OpenPr = { number: number; headRef?: string }

/** List open PRs on the fixture repo (paginated, capped). */
export async function listOpenFixturePrs(input: {
  accessToken: string
  owner?: string
  repo?: string
  maxPages?: number
}): Promise<OpenPr[]> {
  const owner = input.owner || E2E_FIXTURE_OWNER
  const repo = input.repo || E2E_FIXTURE_REPO
  const token = input.accessToken
  const maxPages = input.maxPages ?? 5
  const out: OpenPr[] = []
  for (let page = 1; page <= maxPages; page++) {
    const res = await ghJson<
      Array<{ number?: number; head?: { ref?: string }; state?: string }>
    >(
      token,
      `/repos/${owner}/${repo}/pulls?state=open&per_page=100&page=${page}`,
    )
    if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) break
    for (const pr of res.data) {
      if (typeof pr.number === 'number') {
        out.push({ number: pr.number, headRef: pr.head?.ref })
      }
    }
    if (res.data.length < 100) break
  }
  return out
}

/**
 * Close open fixture PRs (and delete head branches) in parallel.
 * Defaults to every open PR when prNumbers is omitted.
 */
export async function closeStuckFixturePrs(input: {
  accessToken: string
  prNumbers?: number[]
  owner?: string
  repo?: string
}): Promise<{ closed: number[]; detail: string }> {
  const owner = input.owner || E2E_FIXTURE_OWNER
  const repo = input.repo || E2E_FIXTURE_REPO
  const token = input.accessToken

  let targets: OpenPr[]
  if (input.prNumbers && input.prNumbers.length > 0) {
    targets = input.prNumbers.map((n) => ({ number: n }))
  } else {
    try {
      targets = await listOpenFixturePrs({ accessToken: token, owner, repo })
    } catch (err) {
      console.warn(
        '[reset-seed] list open PRs failed:',
        err instanceof Error ? err.message : err,
      )
      return { closed: [], detail: 'list open PRs failed' }
    }
  }

  if (targets.length === 0) {
    return { closed: [], detail: 'no open stuck PRs' }
  }

  const closed = (
    await Promise.all(
      targets.map(async (pr) => {
        try {
          await ghJson(token, `/repos/${owner}/${repo}/issues/${pr.number}/comments`, {
            method: 'POST',
            body: JSON.stringify({
              body: 'Closing stuck Fix Agent e2e PR — fixture reset to seed for a clean rerun.',
            }),
          })
          const prRes = await ghJson<{
            state?: string
            head?: { ref?: string }
          }>(token, `/repos/${owner}/${repo}/pulls/${pr.number}`)
          if (prRes.data.state === 'closed') return null
          const patch = await ghJson(
            token,
            `/repos/${owner}/${repo}/pulls/${pr.number}`,
            {
              method: 'PATCH',
              body: JSON.stringify({ state: 'closed' }),
            },
          )
          const head = pr.headRef || prRes.data.head?.ref
          if (head) {
            await ghJson(
              token,
              `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(head)}`,
              { method: 'DELETE' },
            )
          }
          return patch.ok ? pr.number : null
        } catch (err) {
          console.warn(
            `[reset-seed] close PR #${pr.number} failed:`,
            err instanceof Error ? err.message : err,
          )
          return null
        }
      }),
    )
  ).filter((n): n is number => n != null)

  return {
    closed,
    detail: closed.length
      ? `closed PRs ${closed.join(',')}`
      : 'no open stuck PRs',
  }
}

/**
 * Fire-and-forget PR cleanup so reset_seed is never blocked by GitHub PR API
 * latency. Errors are logged; the reset commit proceeds immediately.
 */
export function scheduleCloseStuckFixturePrs(input: {
  accessToken: string
  owner?: string
  repo?: string
  prNumbers?: number[]
}): void {
  void closeStuckFixturePrs(input)
    .then((r) => {
      if (r.closed.length > 0) {
        console.info(`[reset-seed] ${r.detail}`)
      }
    })
    .catch((err) => {
      console.warn(
        '[reset-seed] background PR cleanup failed:',
        err instanceof Error ? err.message : err,
      )
    })
}

/**
 * Point main at a new commit whose tree equals the seed branch tip.
 * If main already equals seed tip, no-op success.
 * PR cleanup runs in the background and must not delay the reset commit.
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

  // Do not await — stale PR close must not block reset_seed step budget.
  scheduleCloseStuckFixturePrs({ accessToken: token, owner, repo })

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

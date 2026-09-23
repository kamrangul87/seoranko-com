/**
 * POST a GitHub commit status using an installation (or any) access token.
 */

export type CommitStatusState = 'error' | 'failure' | 'pending' | 'success'

export async function postGithubCommitStatus(input: {
  token: string
  owner: string
  repo: string
  sha: string
  state: CommitStatusState
  context: string
  description?: string
  targetUrl?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${input.owner}/${input.repo}/statuses/${encodeURIComponent(input.sha)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        state: input.state,
        context: input.context,
        description: input.description?.slice(0, 140),
        target_url: input.targetUrl,
      }),
      signal: AbortSignal.timeout(20_000),
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `commit status ${res.status}: ${text.slice(0, 200)}` }
  }
  return { ok: true }
}

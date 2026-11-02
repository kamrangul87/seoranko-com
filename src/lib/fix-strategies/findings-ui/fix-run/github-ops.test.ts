import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLiveGithubOps } from './github-ops'

describe('github getPullRequest merged detection', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    // @ts-expect-error test stub
    global.fetch = vi.fn()
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('does not treat merge_commit_sha as merged when merged_at is null', async () => {
    // @ts-expect-error test stub
    global.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ state: 'open', merged_at: null, merge_commit_sha: 'abc123' }),
    })
    const ops = createLiveGithubOps()
    const res = await ops.getPullRequest!({
      creds: { owner: 'o', repo: 'r', accessToken: 't' },
      prNumber: 1,
    })
    expect(res.ok).toBe(true)
    expect(res.merged).toBe(false)
  })
})


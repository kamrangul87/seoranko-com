/**
 * Fail stuck fix/e2e runs; close fixture PRs 3–5; reset main to seed once.
 * Run: npx tsx scripts/cleanup-fixture-stuck.ts
 */
import { createClient } from '@supabase/supabase-js'
import { resetFixtureMainToSeed } from '../src/lib/fix-agent-e2e/reset-seed'
import { resolveGithubAppRepoCreds } from '../src/lib/github-app/resolve-repo-creds'
import {
  E2E_FIXTURE_OWNER,
  E2E_FIXTURE_REPO,
} from '../src/lib/fix-agent-e2e/constants'

const FIX_RUN_ID = '02010c88-b001-4a28-a8a7-39ea373f64d3'
const PRS = [3, 4, 5]

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const master = process.env.MASTER_EMAIL?.trim()
  if (!url || !key || !master) throw new Error('Supabase / MASTER_EMAIL missing')

  const sb = createClient(url, key)
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 200 })
  const user = users.users.find(
    (u) => u.email?.toLowerCase() === master.toLowerCase(),
  )
  if (!user) throw new Error('Master user not found')

  await sb
    .from('fix_strategies_runs')
    .update({
      status: 'failed',
      phase: 'done',
      error_detail: 'Abandoned: apply_next cursor stall (cleanup script)',
      updated_at: new Date().toISOString(),
    })
    .eq('id', FIX_RUN_ID)

  await sb
    .from('e2e_runs')
    .update({
      status: 'failed',
      fail_reason: 'Stopped: apply_next cursor stall cleanup',
      finished_at: new Date().toISOString(),
    })
    .eq('status', 'running')

  const creds = await resolveGithubAppRepoCreds({
    owner: E2E_FIXTURE_OWNER,
    repo: E2E_FIXTURE_REPO,
    userId: user.id,
  })
  if (!creds?.accessToken) throw new Error('GitHub App token unavailable')

  const token = creds.accessToken
  const gh = async (path: string, init?: RequestInit) => {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    })
    return res
  }

  for (const n of PRS) {
    await gh(`/repos/${E2E_FIXTURE_OWNER}/${E2E_FIXTURE_REPO}/issues/${n}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        body: 'Closing stuck Fix Agent e2e PR — fixture reset to seed for a clean rerun.',
      }),
    })
    const prRes = await gh(
      `/repos/${E2E_FIXTURE_OWNER}/${E2E_FIXTURE_REPO}/pulls/${n}`,
    )
    const pr = (await prRes.json()) as { head?: { ref?: string } }
    await gh(`/repos/${E2E_FIXTURE_OWNER}/${E2E_FIXTURE_REPO}/pulls/${n}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' }),
    })
    const head = pr.head?.ref
    if (head) {
      await gh(
        `/repos/${E2E_FIXTURE_OWNER}/${E2E_FIXTURE_REPO}/git/refs/heads/${encodeURIComponent(head)}`,
        { method: 'DELETE' },
      ).catch(() => undefined)
    }
  }

  const reset = await resetFixtureMainToSeed({ accessToken: token })
  if (!reset.ok) throw new Error(reset.error)
  console.info('cleanup ok', reset.detail)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

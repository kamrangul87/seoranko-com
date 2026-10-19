/**
 * Ops: start + tick Fix Agent for one site until await_approval (PR open).
 * Never auto-approves / merges — human approves the customer PR.
 *
 * Auth: Authorization: Bearer $CRON_SECRET
 * Query: ?siteId=<uuid>&maxTicks=40
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/cron-auth'
import { createSupabaseJsClient } from '@/lib/supabase/js-client'
import { findOwnedSiteConnection } from '@/lib/site-connection-lookup'
import { resolveGithubAppRepoCreds } from '@/lib/github-app/resolve-repo-creds'
import {
  startFixRun,
  tickFixRun,
  defaultTickDeps,
  createLiveGithubOps,
  getFixRunStore,
  type GithubPrCreds,
} from '@/lib/fix-strategies/findings-ui/fix-run'
import { resolveSourcesAfterCrawl } from '@/lib/fix-strategies/findings-ui/fix-run/resolve-sources-hook'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function resolveCredsForSite(
  userId: string,
  domain: string,
): Promise<GithubPrCreds | null> {
  const supabase = createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const owned = await findOwnedSiteConnection(
    supabase,
    userId,
    `https://${domain}`,
  )
  if (!owned || owned.cmsType !== 'github') return null

  const owner = String(
    owned.credentials.owner || owned.credentials.github_owner || '',
  )
  const repo = String(
    owned.credentials.repo || owned.credentials.github_repo || '',
  )
  const baseBranch = String(
    owned.credentials.branch || owned.credentials.baseBranch || 'main',
  )
  if (!owner || !repo) return null

  try {
    const app = await resolveGithubAppRepoCreds({
      owner,
      repo,
      baseBranch,
      userId,
    })
    if (app?.accessToken) {
      return {
        owner: app.owner,
        repo: app.repo,
        baseBranch: app.baseBranch || baseBranch,
        accessToken: app.accessToken,
      }
    }
  } catch {
    /* fall through */
  }

  const token = String(
    owned.credentials.accessToken ||
      owned.credentials.token ||
      owned.credentials.github_token ||
      '',
  )
  if (!token) return null
  return { owner, repo, baseBranch, accessToken: token }
}

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const siteId = req.nextUrl.searchParams.get('siteId')
  const maxTicks = Math.min(
    80,
    Math.max(1, Number(req.nextUrl.searchParams.get('maxTicks') || 40)),
  )
  if (!siteId) {
    return NextResponse.json(
      { ok: false, error: 'siteId required' },
      { status: 400 },
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json(
      { ok: false, error: 'supabase env missing' },
      { status: 500 },
    )
  }

  const supabase = createSupabaseJsClient(url, key)
  const { data: site, error } = await supabase
    .from('connected_sites')
    .select('id, user_id, domain')
    .eq('id', siteId)
    .maybeSingle()
  if (error || !site) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'site not found' },
      { status: 404 },
    )
  }

  const userId = String(site.user_id)
  const domain = String(site.domain)

  await resolveSourcesAfterCrawl({
    siteId,
    userId,
    runId: `cron-fix-${Date.now()}`,
    deadlineAt: Date.now() + 90_000,
  })

  const creds = await resolveCredsForSite(userId, domain)
  const githubConnected = Boolean(creds?.accessToken)

  const started = await startFixRun({
    userId,
    siteId,
    siteDomain: domain,
    githubConnected,
  })
  if (!started.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: started.error,
        code: started.code,
        run: started.run,
      },
      { status: started.code === 'already_in_progress' ? 409 : 400 },
    )
  }

  if (!creds) {
    return NextResponse.json({
      ok: false,
      error: 'GitHub credentials unavailable for site — connect repo in Settings',
      run: started.run,
    }, { status: 400 })
  }

  const store = getFixRunStore()
  const deps = defaultTickDeps({
    ops: createLiveGithubOps(),
    creds,
    siteOrigin: `https://${domain}`,
  })

  let run = started.run
  const ticks: Array<{ phase: string; status: string; detail?: string }> = []
  for (let i = 0; i < maxTicks; i++) {
    const t = await tickFixRun({
      runId: run.id,
      userId,
      deps,
    })
    run = t.run
    ticks.push({
      phase: run.phase,
      status: run.status,
      detail: t.detail,
    })
    if (
      run.phase === 'await_approval' ||
      run.status === 'awaiting_approval' ||
      run.status === 'failed' ||
      run.status === 'complete' ||
      run.status === 'cancelled' ||
      Boolean(run.prUrl)
    ) {
      break
    }
    const fresh = await store.getRun(run.id, userId)
    if (fresh) run = fresh
  }

  return NextResponse.json({
    ok: true,
    siteId,
    domain,
    run: {
      id: run.id,
      phase: run.phase,
      status: run.status,
      prUrl: run.prUrl,
      prNumber: run.prNumber,
      branchName: run.branchName,
    },
    ticks: ticks.slice(-12),
    note: 'PR left open for human approval — not merged',
  })
}

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
import { withCustomerWriteGate } from '@/lib/customer-write-gate'

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
  const closePrNumber = Number(req.nextUrl.searchParams.get('closePr') || 0)
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

  let closedPr: { ok: boolean; prNumber?: number; error?: string } | null = null
  if (closePrNumber > 0 && creds) {
    const ops = createLiveGithubOps()
    if (ops.closePullRequest) {
      try {
        const closed = await withCustomerWriteGate(
          'findings-pr-branch',
          { approved: true },
          () =>
            ops.closePullRequest!({
              creds,
              prNumber: closePrNumber,
              comment:
                'Closing without merge: prior fix created a static page that would shadow a live SPA route (Vercel filesystem before rewrites). Superseded by SPA shell canonical strip.',
            }),
        )
        closedPr = closed.ok
          ? { ok: true, prNumber: closePrNumber }
          : { ok: false, prNumber: closePrNumber, error: closed.error }
      } catch (err) {
        closedPr = {
          ok: false,
          prNumber: closePrNumber,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }
  }

  const started = await startFixRun({
    userId,
    siteId,
    siteDomain: domain,
    githubConnected,
  })
  // Continue ticking an in-progress run (cron retries / wait_preview).
  if (!started.ok && started.code !== 'already_in_progress') {
    return NextResponse.json(
      {
        ok: false,
        error: started.error,
        code: started.code,
        run: started.run,
      },
      { status: 400 },
    )
  }
  if (!started.ok && !started.run) {
    return NextResponse.json(
      { ok: false, error: started.error, code: started.code },
      { status: 409 },
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

  let run = started.run!
  const ticks: Array<{ phase: string; status: string; detail?: string }> = []
  try {
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
      // Do not stop merely because prUrl is set — preview verify still needed.
      if (
        run.phase === 'await_approval' ||
        run.status === 'awaiting_approval' ||
        run.status === 'failed' ||
        run.status === 'complete'
      ) {
        break
      }
      const fresh = await store.getRun(run.id, userId)
      if (fresh) run = fresh
    }
  } catch (err) {
    // Last resort: redirect loops / transport bugs must never 500 without JSON.
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        siteId,
        domain,
        closedPr,
        run: {
          id: run.id,
          phase: run.phase,
          status: run.status,
          prUrl: run.prUrl,
          prNumber: run.prNumber,
          branchName: run.branchName,
        },
        ticks: ticks.slice(-12),
        note: 'Tick loop aborted; PR left open for human approval — not merged',
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    siteId,
    domain,
    closedPr,
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

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  customerWriteGateUserMessage,
  isCustomerWriteGateError,
} from '@/lib/customer-write-gate'
import { findOwnedSiteConnection } from '@/lib/site-connection-lookup'
import {
  tickFixRun,
  defaultTickDeps,
  getFixRunStore,
  createLiveGithubOps,
  approveFixRun,
  type GithubPrCreds,
} from '@/lib/fix-strategies/findings-ui/fix-run'
import { resolveGithubAppRepoCreds } from '@/lib/github-app/resolve-repo-creds'
import { startCrawlRun } from '@/lib/fix-strategies/findings-ui/crawl/orchestrator'
import { drainCrawlRunToTerminal } from '@/lib/fix-strategies/findings-ui/crawl/scheduled-recrawl'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'
import { requireMasterUser } from '@/lib/github-app/require-master'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function resolveCredsForRun(
  userId: string,
  domain: string,
): Promise<GithubPrCreds | null> {
  const supabase = createClient(
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

/** POST — tick/approve a fix run. Master account only. */
export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } },
) {
  try {
    const master = await requireMasterUser()
    if (!master.ok) {
      return NextResponse.json({ error: master.error }, { status: master.status })
    }
    const user = master.user

    const runId = ctx.params.id
    const body = (await req.json().catch(() => ({}))) as {
      action?: 'tick' | 'approve'
    }
    const action = body.action || 'tick'

    const store = getFixRunStore()
    const run = await store.getRun(runId, user.id)
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data: site } = await supabase
      .from('connected_sites')
      .select('id, domain')
      .eq('id', run.siteId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 })
    }

    if (action === 'approve') {
      const approved = await approveFixRun({ runId, userId: user.id })
      return NextResponse.json({ ok: true, run: approved })
    }

    const creds = await resolveCredsForRun(user.id, site.domain)
    if (!creds) {
      return NextResponse.json(
        { error: 'GitHub credentials unavailable for this site' },
        { status: 400 },
      )
    }

    const result = await tickFixRun({
      runId,
      userId: user.id,
      deps: defaultTickDeps({
        ops: createLiveGithubOps(),
        creds,
        siteOrigin: `https://${site.domain}`,
        startRecrawl: async (siteId) => {
          // Must drain — startCrawlRun alone leaves status=queued and findings stay open.
          const started = await startCrawlRun({
            siteId,
            userId: user.id,
            origin: `https://${site.domain}`,
          })
          const drained = await drainCrawlRunToTerminal(
            started.runId,
            getFindingsStore(),
          )
          console.info('[fix-strategies/runs/tick] post-run recrawl drained', {
            runId: started.runId,
            status: drained.status,
            done: drained.done,
            finishedAt: drained.finishedAt,
          })
        },
      }),
    })

    return NextResponse.json({
      ok: true,
      run: result.run,
      advanced: result.advanced,
      detail: result.detail,
    })
  } catch (err) {
    console.error('[fix-strategies/runs/tick]', err)
    const error = isCustomerWriteGateError(err)
      ? customerWriteGateUserMessage(err)
      : err instanceof Error &&
          /no active write gate|customer write blocked/i.test(err.message)
        ? customerWriteGateUserMessage(err)
        : err instanceof Error
          ? err.message
          : 'Tick failed'
    return NextResponse.json({ error }, { status: 500 })
  }
}

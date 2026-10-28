import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { createSupabaseJsClient } from '@/lib/supabase/js-client'
import { cookies } from 'next/headers'
import { findOwnedSiteConnection } from '@/lib/site-connection-lookup'
import { assertFixWriteEntitled } from '@/lib/stripe/entitlements'
import {
  startFixRun,
  getFixRunStore,
} from '@/lib/fix-strategies/findings-ui/fix-run'
import { resolveGithubAppRepoCreds } from '@/lib/github-app/resolve-repo-creds'
import { requireMasterUser } from '@/lib/github-app/require-master'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function authUser() {
  const cookieStore = cookies()
  const authClient = createSupabaseSsrClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
  const {
    data: { user },
  } = await authClient.auth.getUser()
  return user
}

async function isGithubConnected(userId: string, siteDomain: string): Promise<boolean> {
  const supabase = createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const owned = await findOwnedSiteConnection(
    supabase,
    userId,
    `https://${siteDomain}`,
  )
  if (!owned || owned.cmsType !== 'github') return false
  const owner = String(
    owned.credentials.owner || owned.credentials.github_owner || '',
  )
  const repo = String(
    owned.credentials.repo || owned.credentials.github_repo || '',
  )
  if (!owner || !repo) return false
  try {
    const app = await resolveGithubAppRepoCreds({
      owner,
      repo,
      userId,
    })
    if (app?.accessToken) return true
  } catch {
    /* fall through */
  }
  const token =
    owned.credentials.accessToken ||
    owned.credentials.token ||
    owned.credentials.github_token
  return Boolean(token)
}

/** POST — start a fix run for a site. Master account only. */
export async function POST(req: NextRequest) {
  try {
    const master = await requireMasterUser()
    if (!master.ok) {
      return NextResponse.json({ error: master.error }, { status: master.status })
    }
    const user = master.user

    const body = (await req.json()) as { siteId?: string }
    if (!body.siteId) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
    }

    const supabase = createSupabaseJsClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data: site } = await supabase
      .from('connected_sites')
      .select('id, domain')
      .eq('id', body.siteId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 })
    }

    await assertFixWriteEntitled({ userId: user.id, email: user.email })

    const githubConnected = await isGithubConnected(user.id, site.domain)
    const started = await startFixRun({
      userId: user.id,
      siteId: site.id,
      siteDomain: site.domain,
      githubConnected,
    })

    if (!started.ok) {
      const status = started.code === 'already_in_progress' ? 409 : 400
      return NextResponse.json(
        {
          error: started.error,
          code: started.code,
          ...(started.run ? { run: started.run } : {}),
        },
        { status },
      )
    }

    return NextResponse.json({ ok: true, run: started.run })
  } catch (err) {
    console.error('[fix-strategies/runs]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start fix run' },
      { status: 500 },
    )
  }
}

/** GET ?siteId= — active run; ?runId= — specific run. */
export async function GET(req: NextRequest) {
  try {
    const user = await authUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const runId = req.nextUrl.searchParams.get('runId')
    const siteId = req.nextUrl.searchParams.get('siteId')
    const includeLastFailed =
      req.nextUrl.searchParams.get('includeLastFailed') === '1' ||
      req.nextUrl.searchParams.get('includeLastFailed') === 'true'
    const store = getFixRunStore()

    if (runId) {
      const run = await store.getRun(runId, user.id)
      if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ ok: true, run })
    }
    if (siteId) {
      const run = await store.listActiveForSite(siteId, user.id)
      if (!includeLastFailed) {
        return NextResponse.json({ ok: true, run })
      }
      const supabase = createSupabaseJsClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
      const { data: rows, error } = await supabase
        .from('fix_strategies_runs')
        .select('id, user_id, site_id, status, phase, pr_number, pr_url, error_detail, created_at')
        .eq('site_id', siteId)
        .eq('user_id', user.id)
        .eq('status', 'failed')
        .not('pr_number', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5)
      if (error) {
        return NextResponse.json({ ok: true, run, recoverable: [] })
      }
      const recoverable = (rows || []).map((r) => ({
        id: String(r.id),
        prNumber: r.pr_number == null ? null : Number(r.pr_number),
        prUrl: (r.pr_url as string | null) ?? null,
        status: String(r.status || ''),
        phase: String(r.phase || ''),
        errorDetail: (r.error_detail as string | null) ?? null,
        createdAt: String(r.created_at),
      }))
      return NextResponse.json({ ok: true, run, recoverable })
    }
    return NextResponse.json(
      { error: 'runId or siteId is required' },
      { status: 400 },
    )
  } catch (err) {
    console.error('[fix-strategies/runs GET]', err)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
}

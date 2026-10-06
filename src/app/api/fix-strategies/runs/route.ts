import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { findOwnedSiteConnection } from '@/lib/site-connection-lookup'
import { assertFixWriteEntitled } from '@/lib/stripe/entitlements'
import {
  startFixRun,
  getFixRunStore,
} from '@/lib/fix-strategies/findings-ui/fix-run'
import { resolveGithubAppRepoCreds } from '@/lib/github-app/resolve-repo-creds'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function authUser() {
  const cookieStore = cookies()
  const authClient = createServerClient(
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
  const supabase = createClient(
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

/** POST — start a fix run for a site. */
export async function POST(req: NextRequest) {
  try {
    const user = await authUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as { siteId?: string }
    if (!body.siteId) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
    }

    const supabase = createClient(
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
      return NextResponse.json(
        { error: started.error, code: started.code },
        { status: 400 },
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
    const store = getFixRunStore()

    if (runId) {
      const run = await store.getRun(runId, user.id)
      if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ ok: true, run })
    }
    if (siteId) {
      const run = await store.listActiveForSite(siteId, user.id)
      return NextResponse.json({ ok: true, run })
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

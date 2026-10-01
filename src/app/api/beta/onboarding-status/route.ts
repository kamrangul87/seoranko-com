import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

type StepId = 'site' | 'github' | 'gsc' | 'crawl' | 'finding' | 'verified'

/**
 * GET — honest beta onboarding checklist from stored evidence (no fabricated progress).
 */
export async function GET() {
  try {
    const cookieStore = cookies()
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
    )
    const {
      data: { user },
    } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    )

    const [sites, github, gscActive, gscExpired, crawls, verified] = await Promise.all([
      supabase
        .from('connected_sites')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabase
        .from('site_connections')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('cms_type', 'github')
        .eq('is_active', true),
      supabase
        .from('gsc_connections')
        .select('id, site_id, property_url, last_sync_at, last_error', { count: 'exact' })
        .eq('user_id', user.id)
        .eq('status', 'active'),
      supabase
        .from('gsc_connections')
        .select('id, site_id, property_url, last_sync_at, last_error')
        .eq('user_id', user.id)
        .in('status', ['expired', 'revoked']),
      supabase
        .from('index_diagnosis_runs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabase
        .from('fix_agent_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'verified'),
    ])

    // Finding reviewed ≈ any Fix Agent attempt or Link Graph audit for this user
    const [attempts, linkAudits] = await Promise.all([
      supabase
        .from('fix_agent_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabase
        .from('link_graph_audits')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
    ])

    const siteDone = (sites.count ?? 0) > 0
    const githubDone = (github.count ?? 0) > 0
    const gscDone = (gscActive.count ?? 0) > 0
    const expiredRows = gscExpired.data || []
    const crawlDone = (crawls.count ?? 0) > 0
    const findingDone = (attempts.count ?? 0) > 0 || (linkAudits.count ?? 0) > 0 || crawlDone
    const verifiedDone = (verified.count ?? 0) > 0

    let gscLabel = 'GSC connected'
    let gscDetail: string | undefined = gscDone
      ? undefined
      : 'Connect Search Console to see Google’s last recorded view.'
    let gscHref = '/dashboard/experiments'
    let gscActionLabel: string | undefined

    if (!gscDone && expiredRows.length > 0) {
      const first = expiredRows[0] as {
        site_id: string
        property_url: string | null
        last_sync_at: string | null
        last_error: string | null
      }
      const { data: expiredSite } = await supabase
        .from('connected_sites')
        .select('domain')
        .eq('id', first.site_id)
        .maybeSingle()
      const siteName = expiredSite?.domain || first.property_url || 'your site'
      const lastSync = first.last_sync_at
        ? new Date(first.last_sync_at).toLocaleDateString()
        : 'never'
      gscLabel = 'GSC expired — reconnect'
      gscDetail = `${siteName}: last successful sync ${lastSync}. Re-authorize Google Search Console — Sync cannot renew a dead refresh token.${
        first.last_error ? ` Last error: ${first.last_error}` : ''
      }`
      gscHref = `/dashboard/experiments?siteId=${encodeURIComponent(first.site_id)}&gsc=reconnect`
      gscActionLabel = 'Reconnect'
    }

    const steps: Array<{
      id: StepId
      label: string
      href: string
      done: boolean
      detail?: string
      actionLabel?: string
    }> = [
      {
        id: 'site',
        label: 'Site connected',
        href: '/dashboard/settings',
        done: siteDone,
        detail: siteDone ? undefined : 'Add the domain you manage.',
      },
      {
        id: 'github',
        label: 'GitHub connected',
        href: '/dashboard/settings',
        done: githubDone,
        detail: githubDone
          ? undefined
          : 'Connect GitHub write access for Fix Agent (beta primary path).',
      },
      {
        id: 'gsc',
        label: gscLabel,
        href: gscHref,
        done: gscDone,
        detail: gscDetail,
        actionLabel: gscActionLabel,
      },
      {
        id: 'crawl',
        label: 'First crawl complete',
        href: '/dashboard/audit',
        done: crawlDone,
        detail: crawlDone ? undefined : 'Run Audit on a live URL.',
      },
      {
        id: 'finding',
        label: 'First finding reviewed',
        href: '/dashboard/audit',
        done: findingDone,
        detail: findingDone ? undefined : 'Open findings from Audit or Link Graph.',
      },
      {
        id: 'verified',
        label: 'First fix verified',
        href: '/dashboard/audit',
        done: verifiedDone,
        detail: verifiedDone
          ? undefined
          : 'Approve a deterministic fix and wait for live re-crawl match.',
      },
    ]

    return NextResponse.json({
      ok: true,
      steps,
      complete: steps.every((s) => s.done),
    })
  } catch (err) {
    console.error('[beta/onboarding-status]', err)
    return NextResponse.json({ error: 'Failed to load onboarding status' }, { status: 500 })
  }
}

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

    const [sites, github, gsc, crawls, verified] = await Promise.all([
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
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'active'),
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
    const gscDone = (gsc.count ?? 0) > 0
    const crawlDone = (crawls.count ?? 0) > 0
    const findingDone = (attempts.count ?? 0) > 0 || (linkAudits.count ?? 0) > 0 || crawlDone
    const verifiedDone = (verified.count ?? 0) > 0

    const steps: Array<{
      id: StepId
      label: string
      href: string
      done: boolean
      detail?: string
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
        label: 'GSC connected',
        href: '/dashboard/experiments',
        done: gscDone,
        detail: gscDone ? undefined : 'Connect Search Console to see Google’s last recorded view.',
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

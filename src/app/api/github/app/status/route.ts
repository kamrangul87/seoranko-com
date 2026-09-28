import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getGithubAppPublicMeta } from '@/lib/github-app/store'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const dynamic = 'force-dynamic'

/**
 * GET /api/github/app/status
 * Public app config (slug/install URL) + the signed-in user's own linked
 * installations, for the "Connect GitHub" UI in dashboard/settings — the
 * App install flow previously had no client-facing entry point or status
 * display even though the backend (setup/callback routes) already worked.
 */
export async function GET() {
  const meta = await getGithubAppPublicMeta()
  if (!meta) {
    return NextResponse.json({ configured: false })
  }

  const base = {
    configured: true as const,
    slug: meta.slug,
    installUrl: `https://github.com/apps/${meta.slug}/installations/new`,
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anon) {
    return NextResponse.json({ ...base, installations: [] })
  }

  const cookieStore = cookies()
  const authClient = createServerClient(supabaseUrl, anon, {
    cookies: { get: (name: string) => cookieStore.get(name)?.value },
  })
  const {
    data: { user },
  } = await authClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ ...base, installations: [] })
  }

  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('github_installations')
    .select('installation_id, account_login, account_type, repository_selection, uninstalled_at, suspended_at')
    .eq('user_id', user.id)
    .is('uninstalled_at', null)

  if (error) {
    return NextResponse.json({ ...base, installations: [] })
  }

  return NextResponse.json({
    ...base,
    installations: (data || []).map((i) => ({
      installationId: i.installation_id,
      accountLogin: i.account_login,
      accountType: i.account_type,
      repositorySelection: i.repository_selection,
      suspended: Boolean(i.suspended_at),
    })),
  })
}

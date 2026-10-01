import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getGithubAppPublicMeta, listInstallationsForUser } from '@/lib/github-app/store'

export const dynamic = 'force-dynamic'

/**
 * GET /api/github/app/status
 * Public app config (slug/install URL) + the signed-in user's linked
 * installations (including orphans claimed via their github site_connections).
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

  try {
    const data = await listInstallationsForUser(user.id)
    return NextResponse.json({
      ...base,
      installations: data.map((i) => ({
        installationId: i.installation_id,
        accountLogin: i.account_login,
        accountType: i.account_type,
        repositorySelection: i.repository_selection,
        suspended: Boolean(i.suspended_at),
      })),
    })
  } catch (err) {
    console.error('[github/app/status]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ...base, installations: [] })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getGithubAppPublicMeta } from '@/lib/github-app/store'
import { GITHUB_APP_URLS } from '@/lib/github-app/urls'

export const dynamic = 'force-dynamic'

const INSTALL_COOKIE = 'seoranko_gh_pending_installation'

/**
 * GET /api/github/app/setup?installation_id=&setup_action=
 * Post-install redirect. Stores pending installation_id and sends the user
 * through App OAuth so we can verify via GET /user/installations.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const installationId = url.searchParams.get('installation_id')
  const setupAction = url.searchParams.get('setup_action') || 'install'

  if (!installationId || !/^\d+$/.test(installationId)) {
    return NextResponse.redirect(
      new URL('/dashboard/settings?github_app=bad_setup', req.url),
    )
  }

  const meta = await getGithubAppPublicMeta()
  if (!meta) {
    return NextResponse.redirect(
      new URL('/dashboard/settings?github_app=app_not_configured', req.url),
    )
  }

  cookies().set(INSTALL_COOKIE, installationId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (supabaseUrl && anon) {
    const cookieStore = cookies()
    const authClient = createServerClient(supabaseUrl, anon, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
      },
    })
    const {
      data: { user },
    } = await authClient.auth.getUser()
    if (!user) {
      return NextResponse.redirect(
        new URL(
          `/login?next=${encodeURIComponent(url.pathname + url.search)}`,
          req.url,
        ),
      )
    }
  }

  // Request user authorization so we can call GET /user/installations.
  const authorize = new URL('https://github.com/login/oauth/authorize')
  authorize.searchParams.set('client_id', meta.clientId)
  authorize.searchParams.set('redirect_uri', GITHUB_APP_URLS.oauthCallback)
  authorize.searchParams.set('state', `${setupAction}.${installationId}`)

  return NextResponse.redirect(authorize.toString())
}

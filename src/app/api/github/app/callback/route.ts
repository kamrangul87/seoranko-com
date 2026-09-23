import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import {
  exchangeOauthCodeForUserToken,
  userHasInstallation,
} from '@/lib/github-app/auth'
import { upsertInstallation } from '@/lib/github-app/store'
import { GITHUB_APP_URLS } from '@/lib/github-app/urls'

export const dynamic = 'force-dynamic'

const INSTALL_COOKIE = 'seoranko_gh_pending_installation'

/**
 * GET /api/github/app/callback?code=
 * OAuth callback after request_oauth_on_install — verifies installation via
 * GET /user/installations, then links it to the signed-in SEORANKO user.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const installationIdRaw =
    url.searchParams.get('installation_id') ||
    cookies().get(INSTALL_COOKIE)?.value ||
    null

  if (!code) {
    return NextResponse.redirect(
      new URL('/dashboard/settings?github_app=missing_code', req.url),
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anon) {
    return NextResponse.redirect(new URL('/dashboard/settings?github_app=auth_config', req.url))
  }

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
        `/login?next=${encodeURIComponent(GITHUB_APP_URLS.oauthCallback + url.search)}`,
        req.url,
      ),
    )
  }

  try {
    const userToken = await exchangeOauthCodeForUserToken(code)
    const installationId = installationIdRaw ? Number(installationIdRaw) : NaN
    if (!Number.isFinite(installationId)) {
      return NextResponse.redirect(
        new URL('/dashboard/settings?github_app=missing_installation', req.url),
      )
    }

    const allowed = await userHasInstallation(userToken, installationId)
    if (!allowed) {
      return NextResponse.redirect(
        new URL('/dashboard/settings?github_app=install_not_visible', req.url),
      )
    }

    const metaRes = await fetch(`https://api.github.com/user/installations/${installationId}`, {
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    })
    const meta = metaRes.ok
      ? ((await metaRes.json()) as {
          id: number
          account?: { login?: string; type?: string; id?: number }
          repository_selection?: string
        })
      : null

    // Prefer GitHub metadata; never clobber a known account_login with "unknown".
    const accountLogin = meta?.account?.login
    if (accountLogin) {
      await upsertInstallation({
        installationId,
        accountLogin,
        accountType: meta?.account?.type || 'User',
        accountId: meta?.account?.id ?? null,
        userId: user.id,
        repositorySelection: meta?.repository_selection ?? null,
        uninstalledAt: null,
        suspendedAt: null,
        raw: meta,
      })
    } else {
      // OAuth meta lacked account — sync from App API, then attach user_id only.
      try {
        const { syncGithubAppInstallationsFromApi } = await import(
          '@/lib/github-app/resolve-repo-creds'
        )
        await syncGithubAppInstallationsFromApi()
      } catch {
        // non-fatal
      }
      const { createServiceRoleClient } = await import('@/lib/supabase/service-role')
      const supabase = createServiceRoleClient()
      await supabase
        .from('github_installations')
        .update({ user_id: user.id, updated_at: new Date().toISOString() })
        .eq('installation_id', installationId)
    }

    cookies().set(INSTALL_COOKIE, '', { path: '/', maxAge: 0 })
    return NextResponse.redirect(
      new URL('/dashboard/settings?github_app=connected', req.url),
    )
  } catch {
    return NextResponse.redirect(
      new URL('/dashboard/settings?github_app=oauth_failed', req.url),
    )
  }
}

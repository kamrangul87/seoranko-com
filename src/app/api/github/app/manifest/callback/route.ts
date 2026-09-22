import { NextRequest, NextResponse } from 'next/server'
import { exchangeManifestCode } from '@/lib/github-app/exchange-manifest'
import { requireMasterUser } from '@/lib/github-app/require-master'
import {
  clearManifestStateCookie,
  verifyManifestState,
} from '@/lib/github-app/state'
import { getGithubAppPublicMeta, saveGithubAppFromManifest } from '@/lib/github-app/store'
import { GITHUB_APP_URLS } from '@/lib/github-app/urls'

export const dynamic = 'force-dynamic'

/**
 * GET /api/github/app/manifest/callback?code=&state=
 * Completes the GitHub App Manifest handshake (owner only).
 */
export async function GET(req: NextRequest) {
  const master = await requireMasterUser()
  if (!master.ok) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(GITHUB_APP_URLS.adminSetupPage)}`, req.url),
    )
  }

  const existing = await getGithubAppPublicMeta()
  if (existing) {
    return NextResponse.redirect(
      new URL(`${GITHUB_APP_URLS.adminSetupPage}?already=1`, req.url),
    )
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (!verifyManifestState(state)) {
    clearManifestStateCookie()
    return NextResponse.redirect(
      new URL(`${GITHUB_APP_URLS.adminSetupPage}?error=invalid_state`, req.url),
    )
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(`${GITHUB_APP_URLS.adminSetupPage}?error=missing_code`, req.url),
    )
  }

  try {
    const converted = await exchangeManifestCode(code)
    await saveGithubAppFromManifest({
      appId: converted.id,
      slug: converted.slug || converted.name || 'SEORANKO',
      clientId: converted.client_id,
      htmlUrl: converted.html_url ?? null,
      privateKeyPem: converted.pem,
      clientSecret: converted.client_secret,
      webhookSecret: converted.webhook_secret,
      createdByUserId: master.user.id,
    })
    clearManifestStateCookie()
    return NextResponse.redirect(
      new URL(`${GITHUB_APP_URLS.adminSetupPage}?created=1`, req.url),
    )
  } catch (e) {
    clearManifestStateCookie()
    const msg = e instanceof Error ? e.message : 'exchange_failed'
    // Do not put secrets in the redirect query.
    const safe = /secret|pem|key|token/i.test(msg) ? 'exchange_failed' : msg.slice(0, 80)
    return NextResponse.redirect(
      new URL(
        `${GITHUB_APP_URLS.adminSetupPage}?error=${encodeURIComponent(safe)}`,
        req.url,
      ),
    )
  }
}

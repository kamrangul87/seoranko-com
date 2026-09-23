import { NextRequest, NextResponse } from 'next/server'
import {
  conversionMetaWithoutSecrets,
  exchangeManifestCode,
} from '@/lib/github-app/exchange-manifest'
import { verifyGithubAppJwtAlive } from '@/lib/github-app/auth'
import { requireMasterUser } from '@/lib/github-app/require-master'
import {
  clearManifestStateCookie,
  manifestStateErrorMessage,
  verifyManifestStateDetailed,
} from '@/lib/github-app/state'
import { getGithubAppPublicMeta, saveGithubAppFromManifest } from '@/lib/github-app/store'
import { GITHUB_APP_URLS } from '@/lib/github-app/urls'

export const dynamic = 'force-dynamic'

/**
 * GET /api/github/app/manifest/callback?code=&state=
 * Completes the GitHub App Manifest handshake (owner only).
 * Verifies GET /app with the new JWT BEFORE writing credentials — never
 * leave a stale row for an App GitHub does not recognize.
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

  const stateCheck = verifyManifestStateDetailed(state)
  if (!stateCheck.ok) {
    clearManifestStateCookie()
    return NextResponse.redirect(
      new URL(
        `${GITHUB_APP_URLS.adminSetupPage}?error=${encodeURIComponent(
          manifestStateErrorMessage(stateCheck.reason),
        )}`,
        req.url,
      ),
    )
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(`${GITHUB_APP_URLS.adminSetupPage}?error=missing_code`, req.url),
    )
  }

  try {
    const converted = await exchangeManifestCode(code)

    // Verify the App is alive on GitHub BEFORE any DB write.
    const probe = await verifyGithubAppJwtAlive({
      appId: converted.id,
      privateKeyPem: converted.pem,
    })
    if (!probe.ok) {
      clearManifestStateCookie()
      const detail = `GET /app returned ${probe.status}: ${probe.error}. Credentials were NOT stored — start again.`
      console.error('[github-app-manifest] verify-before-store failed', {
        appId: converted.id,
        slug: converted.slug,
        status: probe.status,
        error: probe.error,
        owner: converted.owner,
        fieldNames: converted.fieldNames,
      })
      return NextResponse.redirect(
        new URL(
          `${GITHUB_APP_URLS.adminSetupPage}?error=${encodeURIComponent(detail.slice(0, 180))}`,
          req.url,
        ),
      )
    }

    const ownerLogin = converted.owner?.login || probe.ownerLogin
    const ownerType = converted.owner?.type || probe.ownerType
    const ownerId = converted.owner?.id ?? probe.ownerId

    await saveGithubAppFromManifest({
      appId: converted.id,
      slug: converted.slug || converted.name || probe.slug || 'SEORANKO',
      clientId: converted.client_id,
      htmlUrl: converted.html_url ?? null,
      privateKeyPem: converted.pem,
      clientSecret: converted.client_secret,
      webhookSecret: converted.webhook_secret,
      createdByUserId: master.user.id,
      ownerLogin: ownerLogin ?? null,
      ownerType: ownerType ?? null,
      ownerId: ownerId ?? null,
      conversionAt: converted.convertedAt,
      conversionFieldNames: converted.fieldNames,
      conversionResponseMeta: {
        ...conversionMetaWithoutSecrets(converted),
        get_app_verify: {
          status: probe.status,
          name: probe.name,
          slug: probe.slug,
          owner_login: probe.ownerLogin,
          owner_type: probe.ownerType,
          owner_id: probe.ownerId,
        },
      },
    })
    clearManifestStateCookie()
    return NextResponse.redirect(
      new URL(`${GITHUB_APP_URLS.adminSetupPage}?created=1`, req.url),
    )
  } catch (e) {
    clearManifestStateCookie()
    const msg = e instanceof Error ? e.message : 'exchange_failed'
    console.error('[github-app-manifest] callback failed (nothing stored)', {
      message: /secret|pem|key|token/i.test(msg) ? 'exchange_failed' : msg.slice(0, 200),
    })
    // Do not put secrets in the redirect query.
    const safe = /secret|pem|key|token/i.test(msg) ? 'exchange_failed' : msg.slice(0, 180)
    return NextResponse.redirect(
      new URL(
        `${GITHUB_APP_URLS.adminSetupPage}?error=${encodeURIComponent(safe)}`,
        req.url,
      ),
    )
  }
}

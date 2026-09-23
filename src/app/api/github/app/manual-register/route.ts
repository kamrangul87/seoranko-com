import { NextRequest, NextResponse } from 'next/server'
import { verifyGithubAppJwtAlive } from '@/lib/github-app/auth'
import { requireMasterUser } from '@/lib/github-app/require-master'
import { getGithubAppPublicMeta, saveGithubAppCredentials } from '@/lib/github-app/store'
import { GITHUB_APP_URLS } from '@/lib/github-app/urls'

export const dynamic = 'force-dynamic'

function safeErrorMessage(raw: string): string {
  if (/secret|pem|key|token|BEGIN/i.test(raw)) return 'register_failed'
  return raw.slice(0, 180)
}

function redirectSetup(req: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL(GITHUB_APP_URLS.adminSetupPage, req.url)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return NextResponse.redirect(url)
}

/**
 * POST /api/github/app/manual-register
 * Owner pastes App credentials after creating the App on GitHub manually.
 * Verifies GET /app with a fresh JWT BEFORE any DB write.
 */
export async function POST(req: NextRequest) {
  const master = await requireMasterUser()
  if (!master.ok) {
    if (master.status === 401) {
      return NextResponse.redirect(
        new URL(`/login?next=${encodeURIComponent(GITHUB_APP_URLS.adminSetupPage)}`, req.url),
      )
    }
    return new NextResponse('Forbidden — owner account only.', { status: 403 })
  }

  const existing = await getGithubAppPublicMeta()
  if (existing) {
    return redirectSetup(req, { already: '1' })
  }

  let appIdRaw = ''
  let clientId = ''
  let clientSecret = ''
  let webhookSecret = ''
  let privateKeyPem = ''

  const contentType = req.headers.get('content-type') || ''
  try {
    if (contentType.includes('application/json')) {
      const body = (await req.json()) as Record<string, unknown>
      appIdRaw = String(body.app_id ?? body.appId ?? '')
      clientId = String(body.client_id ?? body.clientId ?? '').trim()
      clientSecret = String(body.client_secret ?? body.clientSecret ?? '')
      webhookSecret = String(body.webhook_secret ?? body.webhookSecret ?? '')
      privateKeyPem = String(body.private_key_pem ?? body.privateKeyPem ?? '')
    } else {
      const form = await req.formData()
      appIdRaw = String(form.get('app_id') ?? '')
      clientId = String(form.get('client_id') ?? '').trim()
      clientSecret = String(form.get('client_secret') ?? '')
      webhookSecret = String(form.get('webhook_secret') ?? '')
      privateKeyPem = String(form.get('private_key_pem') ?? '')
    }
  } catch {
    return redirectSetup(req, { error: 'Invalid form body' })
  }

  // Normalize PEM newlines from paste (browsers may use \r\n).
  privateKeyPem = privateKeyPem.replace(/\r\n/g, '\n').trim()
  clientSecret = clientSecret.trim()
  webhookSecret = webhookSecret.trim()

  const appId = Number(appIdRaw)
  if (!Number.isFinite(appId) || appId <= 0) {
    return redirectSetup(req, { error: 'App ID must be a positive number' })
  }
  if (!clientId || !clientSecret || !webhookSecret || !privateKeyPem) {
    return redirectSetup(req, { error: 'All fields are required' })
  }
  if (!/BEGIN .+PRIVATE KEY/.test(privateKeyPem)) {
    return redirectSetup(req, {
      error: 'Private key must be a PEM block (BEGIN … PRIVATE KEY)',
    })
  }

  try {
    const probe = await verifyGithubAppJwtAlive({
      appId,
      privateKeyPem,
    })
    if (!probe.ok) {
      console.error('[github-app-manual] verify-before-store failed', {
        appId,
        status: probe.status,
        error: probe.error,
      })
      return redirectSetup(req, {
        error: `GET /app returned ${probe.status}: ${safeErrorMessage(probe.error)}. Credentials were NOT stored.`,
      })
    }

    const slug = probe.slug || 'seoranko'
    const ownerLogin = probe.ownerLogin
    const ownerType = probe.ownerType
    const registeredAt = new Date().toISOString()
    const htmlUrlFromProbe =
      probe.raw.html_url != null ? String(probe.raw.html_url) : null

    await saveGithubAppCredentials({
      appId,
      slug,
      clientId,
      htmlUrl: htmlUrlFromProbe || `https://github.com/apps/${encodeURIComponent(slug)}`,
      privateKeyPem,
      clientSecret,
      webhookSecret,
      createdByUserId: master.user.id,
      ownerLogin,
      ownerType,
      ownerId: probe.ownerId,
      conversionAt: registeredAt,
      conversionFieldNames: null,
      conversionResponseMeta: {
        source: 'manual_register',
        registered_at: registeredAt,
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

    return redirectSetup(req, {
      created: '1',
      owner: ownerLogin || '',
      slug,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'register_failed'
    console.error('[github-app-manual] register failed (nothing stored)', {
      message: safeErrorMessage(msg),
    })
    return redirectSetup(req, { error: safeErrorMessage(msg) })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { diagnoseGithubAppJwt } from '@/lib/github-app/auth'
import { requireMasterUser } from '@/lib/github-app/require-master'
import { GITHUB_APP_URLS } from '@/lib/github-app/urls'

export const dynamic = 'force-dynamic'

/**
 * TEMPORARY owner-only diagnostic: POST App ID + PEM → JWT claims + GET /app
 * result. Never returns or logs the private key or JWT.
 *
 * POST /api/admin/github-app-jwt-diagnose
 * body: multipart/form-data or JSON { app_id, private_key_pem }
 */
export async function POST(req: NextRequest) {
  const master = await requireMasterUser()
  if (!master.ok) {
    if (master.status === 401) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Forbidden — owner account only' }, { status: 403 })
  }

  let appIdRaw = ''
  let privateKeyPem = ''
  const contentType = req.headers.get('content-type') || ''
  try {
    if (contentType.includes('application/json')) {
      const body = (await req.json()) as Record<string, unknown>
      appIdRaw = String(body.app_id ?? body.appId ?? '')
      privateKeyPem = String(body.private_key_pem ?? body.privateKeyPem ?? '')
    } else {
      const form = await req.formData()
      appIdRaw = String(form.get('app_id') ?? '')
      privateKeyPem = String(form.get('private_key_pem') ?? '')
    }
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  privateKeyPem = privateKeyPem.replace(/\r\n/g, '\n').trim()
  const appId = Number(appIdRaw)
  if (!Number.isFinite(appId) || appId <= 0) {
    return NextResponse.json({ error: 'app_id must be a positive number' }, { status: 400 })
  }
  if (!privateKeyPem) {
    return NextResponse.json({ error: 'private_key_pem is required' }, { status: 400 })
  }

  const diag = await diagnoseGithubAppJwt({ appId, privateKeyPem })
  // Belt-and-suspenders: never leak key material if a field slips in.
  const json = JSON.stringify(diag)
  if (/BEGIN .+PRIVATE KEY|-----BEGIN/.test(json)) {
    return NextResponse.json(
      { error: 'diagnostic aborted — refusing to serialize key material' },
      { status: 500 },
    )
  }

  console.info('[github-app-jwt-diagnose]', {
    appId,
    ok: diag.ok,
    stage: diag.stage,
    githubStatus:
      diag.github && typeof diag.github === 'object'
        ? (diag.github as { status?: number }).status
        : null,
  })

  return NextResponse.json(diag, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}

/** Browser-friendly hint for owners hitting this URL directly. */
export async function GET() {
  const master = await requireMasterUser()
  if (!master.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: master.status })
  }
  return NextResponse.json({
    usage: 'POST app_id + private_key_pem (multipart or JSON)',
    setup: GITHUB_APP_URLS.adminSetupPage,
    note: 'Temporary diagnostic — never returns the key or JWT',
  })
}

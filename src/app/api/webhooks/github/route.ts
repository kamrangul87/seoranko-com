import { NextRequest, NextResponse } from 'next/server'
import {
  loadGithubAppRecord,
  markInstallationUninstalled,
  upsertInstallation,
} from '@/lib/github-app/store'
import { verifyGithubWebhookSignature } from '@/lib/github-app/webhook'

export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/github
 * Verifies X-Hub-Signature-256, handles installation / installation_repositories.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256')
  const event = req.headers.get('x-github-event') || ''

  const app = await loadGithubAppRecord()
  if (!app) {
    return NextResponse.json({ error: 'GitHub App not configured' }, { status: 503 })
  }

  if (!verifyGithubWebhookSignature(rawBody, signature, app.webhookSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = String(payload.action || '')
  const installation = payload.installation as
    | {
        id?: number
        account?: { login?: string; type?: string; id?: number }
        repository_selection?: string
        suspended_at?: string | null
      }
    | undefined

  if (event === 'installation' && installation?.id) {
    if (action === 'deleted') {
      await markInstallationUninstalled(Number(installation.id))
      return NextResponse.json({ ok: true, handled: 'uninstalled' })
    }
    if (action === 'suspend') {
      await upsertInstallation({
        installationId: Number(installation.id),
        accountLogin: installation.account?.login || 'unknown',
        accountType: installation.account?.type || 'User',
        accountId: installation.account?.id ?? null,
        repositorySelection: installation.repository_selection ?? null,
        suspendedAt: new Date().toISOString(),
        raw: payload,
      })
      return NextResponse.json({ ok: true, handled: 'suspended' })
    }
    if (action === 'unsuspend' || action === 'created' || action === 'new_permissions_accepted') {
      await upsertInstallation({
        installationId: Number(installation.id),
        accountLogin: installation.account?.login || 'unknown',
        accountType: installation.account?.type || 'User',
        accountId: installation.account?.id ?? null,
        repositorySelection: installation.repository_selection ?? null,
        suspendedAt: null,
        uninstalledAt: null,
        raw: payload,
      })
      return NextResponse.json({ ok: true, handled: action })
    }
  }

  if (event === 'installation_repositories' && installation?.id) {
    await upsertInstallation({
      installationId: Number(installation.id),
      accountLogin: installation.account?.login || 'unknown',
      accountType: installation.account?.type || 'User',
      accountId: installation.account?.id ?? null,
      repositorySelection: installation.repository_selection ?? null,
      raw: payload,
    })
    return NextResponse.json({ ok: true, handled: 'installation_repositories' })
  }

  // Acknowledge other events without failing delivery.
  return NextResponse.json({ ok: true, ignored: event || 'unknown' })
}

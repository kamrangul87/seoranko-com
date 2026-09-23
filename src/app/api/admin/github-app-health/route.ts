/**
 * Owner-only health check for the product GitHub App.
 * Confirms ciphertext decrypts server-side without exposing secrets.
 */

import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { requireMasterUser } from '@/lib/github-app/require-master'
import { loadGithubAppRecord } from '@/lib/github-app/store'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { mintInstallationAccessToken } from '@/lib/github-app/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const master = await requireMasterUser()
  if (!master.ok) {
    return NextResponse.json({ error: master.error }, { status: master.status })
  }

  const url = new URL(req.url)
  const mintRepo = url.searchParams.get('mint_repo') // e.g. autodun-ai
  const mintOwner = url.searchParams.get('mint_owner') // e.g. kamrangul87

  try {
    const app = await loadGithubAppRecord()
    if (!app) {
      return NextResponse.json({ ok: false, error: 'GitHub App not configured' }, { status: 404 })
    }

    const supabase = createServiceRoleClient()
    const { data: ciphertextRow } = await supabase
      .from('github_app_config')
      .select('credentials_ciphertext')
      .maybeSingle()

    const ciphertext = ciphertextRow?.credentials_ciphertext || ''
    const { data: installs } = await supabase
      .from('github_installations')
      .select(
        'installation_id, account_login, repository_selection, uninstalled_at, suspended_at, updated_at',
      )
      .order('updated_at', { ascending: false })
      .limit(20)

    const body: Record<string, unknown> = {
      ok: true,
      appId: app.appId,
      slug: app.slug,
      clientId: app.clientId,
      encryptedAtRest: ciphertext.startsWith('enc:v1:'),
      ciphertextLength: ciphertext.length,
      secretsReadable: {
        privateKeyPem: app.privateKeyPem.includes('PRIVATE KEY'),
        privateKeyFingerprint12: createHash('sha256')
          .update(app.privateKeyPem)
          .digest('hex')
          .slice(0, 12),
        clientSecret: app.clientSecret.length > 8,
        clientSecretLen: app.clientSecret.length,
        webhookSecret: app.webhookSecret.length > 8,
        webhookSecretLen: app.webhookSecret.length,
      },
      installations: (installs || []).map((i) => ({
        installationId: i.installation_id,
        accountLogin: i.account_login,
        repositorySelection: i.repository_selection,
        uninstalled: !!i.uninstalled_at,
        suspended: !!i.suspended_at,
        updatedAt: i.updated_at,
      })),
    }

    if (mintOwner && mintRepo) {
      const active = (installs || []).find(
        (i) =>
          !i.uninstalled_at &&
          !i.suspended_at &&
          String(i.account_login).toLowerCase() === mintOwner.toLowerCase(),
      )
      if (!active) {
        body.mint = { ok: false, error: 'No active installation for owner' }
      } else {
        const minted = await mintInstallationAccessToken({
          installationId: Number(active.installation_id),
          repositories: [mintRepo],
        })
        const full = `${mintOwner}/${mintRepo}`.toLowerCase()
        const repos = minted.repositories.map((r) => r.toLowerCase())
        body.mint = {
          ok: true,
          installationId: Number(active.installation_id),
          expiresAt: minted.expiresAt,
          repositories: minted.repositories,
          tokenPrefix: minted.token.slice(0, 4) + '…',
          restrictedToTarget:
            repos.length === 0
              ? 'unknown (API omitted repository list)'
              : repos.every((r) => r === full || r === mintRepo.toLowerCase()),
        }
      }
    }

    return NextResponse.json(body)
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

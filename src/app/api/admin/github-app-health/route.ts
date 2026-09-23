/**
 * Owner-only health check for the product GitHub App.
 * Confirms ciphertext decrypts server-side without exposing secrets.
 * Optional ?probe_app=1 — JWT + GET https://api.github.com/app (diagnose existence/owner).
 */

import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { requireMasterUser } from '@/lib/github-app/require-master'
import { createGithubAppJwt, mintInstallationAccessToken } from '@/lib/github-app/auth'
import { loadGithubAppRecord } from '@/lib/github-app/store'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const master = await requireMasterUser()
  if (!master.ok) {
    return NextResponse.json({ error: master.error }, { status: master.status })
  }

  const url = new URL(req.url)
  const mintRepo = url.searchParams.get('mint_repo') // e.g. autodun-ai
  const mintOwner = url.searchParams.get('mint_owner') // e.g. kamrangul87
  const probeApp = url.searchParams.get('probe_app') === '1'

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
      htmlUrl: app.htmlUrl,
      createdAt: app.createdAt,
      encryptedAtRest: ciphertext.startsWith('enc:v1:'),
      ciphertextLength: ciphertext.length,
      /** Manifest conversion fields we persist — owner was never stored. */
      storedFromManifest: {
        id: app.appId,
        slug: app.slug,
        client_id: app.clientId,
        html_url: app.htmlUrl,
        owner: null,
        ownerNote:
          'exchangeManifestCode only typed/saved id, slug, client_id, html_url, pem, secrets — no owner field persisted',
      },
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

    if (probeApp) {
      const jwt = createGithubAppJwt(app.appId, app.privateKeyPem)
      const res = await fetch('https://api.github.com/app', {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(20_000),
      })
      const text = await res.text()
      let json: Record<string, unknown> | null = null
      try {
        json = JSON.parse(text) as Record<string, unknown>
      } catch {
        json = null
      }
      const owner =
        (json?.owner as { login?: string; type?: string; id?: number } | undefined) || null
      body.githubAppProbe = {
        status: res.status,
        statusText: res.statusText,
        errorMessage: json && typeof json.message === 'string' ? json.message : null,
        documentationUrl:
          json && typeof json.documentation_url === 'string' ? json.documentation_url : null,
        rawBodyPreview: text.slice(0, 400),
        app: json
          ? {
              id: json.id ?? null,
              name: json.name ?? null,
              slug: json.slug ?? null,
              html_url: json.html_url ?? null,
              owner_login: owner?.login ?? null,
              owner_type: owner?.type ?? null,
              owner_id: owner?.id ?? null,
            }
          : null,
      }
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

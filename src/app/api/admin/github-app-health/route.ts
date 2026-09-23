/**
 * Owner-only health check for the product GitHub App.
 * Confirms ciphertext decrypts server-side without exposing secrets.
 * Optional ?probe_app=1 — JWT + GET https://api.github.com/app (diagnose existence/owner).
 */

import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { requireMasterUser } from '@/lib/github-app/require-master'
import { createGithubAppJwt, mintInstallationAccessToken } from '@/lib/github-app/auth'
import { postGithubCommitStatus } from '@/lib/github-app/commit-status'
import { loadGithubAppRecord } from '@/lib/github-app/store'
import { syncGithubAppInstallationsFromApi } from '@/lib/github-app/resolve-repo-creds'
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
  const repairInstalls = url.searchParams.get('repair_installs') === '1'
  const proveScope = url.searchParams.get('prove_scope') === '1'
  const e2eNoop = url.searchParams.get('e2e_noop') === '1'

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

    if (repairInstalls) {
      body.repairInstalls = await syncGithubAppInstallationsFromApi()
      // Refresh installs list after sync
      const { data: repaired } = await supabase
        .from('github_installations')
        .select(
          'installation_id, account_login, repository_selection, uninstalled_at, suspended_at, updated_at',
        )
        .order('updated_at', { ascending: false })
        .limit(20)
      body.installations = (repaired || []).map((i) => ({
        installationId: i.installation_id,
        accountLogin: i.account_login,
        repositorySelection: i.repository_selection,
        uninstalled: !!i.uninstalled_at,
        suspended: !!i.suspended_at,
        updatedAt: i.updated_at,
      }))
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
      const installList = (body.installations as Array<{
        installationId: number
        accountLogin: string
        uninstalled: boolean
        suspended: boolean
      }>) || []
      const active = installList.find(
        (i) =>
          !i.uninstalled &&
          !i.suspended &&
          String(i.accountLogin).toLowerCase() === mintOwner.toLowerCase(),
      )
      if (!active) {
        body.mint = { ok: false, error: 'No active installation for owner' }
      } else {
        const minted = await mintInstallationAccessToken({
          installationId: Number(active.installationId),
          repositories: [mintRepo],
        })
        const full = `${mintOwner}/${mintRepo}`.toLowerCase()
        const repos = minted.repositories.map((r) => r.toLowerCase())
        const mintResult: Record<string, unknown> = {
          ok: true,
          installationId: Number(active.installationId),
          expiresAt: minted.expiresAt,
          repositories: minted.repositories,
          tokenPrefix: minted.token.slice(0, 4) + '…',
          restrictedToTarget:
            repos.length === 0
              ? 'unknown (API omitted repository list)'
              : repos.every((r) => r === full || r === mintRepo.toLowerCase()),
        }

        if (proveScope) {
          const headers = {
            Authorization: `Bearer ${minted.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'seoranko-github-app',
          }
          const allowed = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(mintOwner)}/${encodeURIComponent(mintRepo)}`,
            { headers, signal: AbortSignal.timeout(15_000) },
          )
          const denied = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(mintOwner)}/seoranko-com`,
            { headers, signal: AbortSignal.timeout(15_000) },
          )
          const listed = await fetch('https://api.github.com/installation/repositories', {
            headers,
            signal: AbortSignal.timeout(15_000),
          })
          const listedJson = listed.ok
            ? ((await listed.json()) as {
                total_count?: number
                repositories?: Array<{ full_name?: string }>
              })
            : null
          mintResult.scopeProof = {
            targetRepoStatus: allowed.status,
            otherRepoStatus: denied.status,
            otherRepoDenied: denied.status === 403 || denied.status === 404,
            installationReposTotal: listedJson?.total_count ?? null,
            installationReposNames:
              listedJson?.repositories?.map((r) => r.full_name).filter(Boolean) ?? [],
          }
        }

        body.mint = mintResult
      }
    }

    // Owner-only: open a tiny no-op PR on autodun-ai via App installation token
    // (proves fix-flow App path without PAT).
    if (e2eNoop && mintOwner && mintRepo) {
      const mint = body.mint as
        | { ok?: boolean; installationId?: number }
        | undefined
      if (!mint?.ok || !mint.installationId) {
        body.e2eNoop = { ok: false, error: 'mint required first (set mint_owner+mint_repo)' }
      } else {
        const minted = await mintInstallationAccessToken({
          installationId: Number(mint.installationId),
          repositories: [mintRepo],
        })
        const token = minted.token
        const headers = {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'seoranko-github-app',
          'Content-Type': 'application/json',
        }
        const baseRes = await fetch(
          `https://api.github.com/repos/${mintOwner}/${mintRepo}/git/ref/heads/main`,
          { headers, signal: AbortSignal.timeout(20_000) },
        )
        if (!baseRes.ok) {
          body.e2eNoop = {
            ok: false,
            error: `read main ref failed (${baseRes.status})`,
          }
        } else {
          const baseJson = (await baseRes.json()) as { object?: { sha?: string } }
          const baseSha = baseJson.object?.sha
          if (!baseSha) {
            body.e2eNoop = { ok: false, error: 'main sha missing' }
          } else {
            const branch = `seoranko/app-e2e-noop-${Date.now().toString(36)}`
            const refRes = await fetch(
              `https://api.github.com/repos/${mintOwner}/${mintRepo}/git/refs`,
              {
                method: 'POST',
                headers,
                body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
                signal: AbortSignal.timeout(20_000),
              },
            )
            if (!refRes.ok) {
              const t = await refRes.text()
              body.e2eNoop = {
                ok: false,
                error: `create branch failed (${refRes.status}): ${t.slice(0, 200)}`,
              }
            } else {
              // Tiny no-op: update a marker file under .seoranko/
              const path = '.seoranko/app-e2e-noop.txt'
              const content = `seoranko github app e2e noop ${new Date().toISOString()}\n`
              const putRes = await fetch(
                `https://api.github.com/repos/${mintOwner}/${mintRepo}/contents/${encodeURIComponent(path)}`,
                {
                  method: 'PUT',
                  headers,
                  body: JSON.stringify({
                    message: 'chore(seoranko): GitHub App e2e no-op',
                    content: Buffer.from(content, 'utf8').toString('base64'),
                    branch,
                  }),
                  signal: AbortSignal.timeout(20_000),
                },
              )
              const putText = await putRes.text()
              if (!putRes.ok) {
                body.e2eNoop = {
                  ok: false,
                  error: `commit failed (${putRes.status}): ${putText.slice(0, 200)}`,
                }
              } else {
                const putJson = JSON.parse(putText) as {
                  commit?: { sha?: string }
                  content?: { sha?: string }
                }
                const commitSha = putJson.commit?.sha || ''
                const prRes = await fetch(
                  `https://api.github.com/repos/${mintOwner}/${mintRepo}/pulls`,
                  {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                      title: 'chore(seoranko): GitHub App e2e no-op',
                      head: branch,
                      base: 'main',
                      body: 'Opened by SEORANKO GitHub App installation token (repo-scoped). Safe to close.',
                      draft: true,
                    }),
                    signal: AbortSignal.timeout(20_000),
                  },
                )
                const prText = await prRes.text()
                if (!prRes.ok) {
                  body.e2eNoop = {
                    ok: false,
                    error: `PR failed (${prRes.status}): ${prText.slice(0, 200)}`,
                    commitSha,
                    branch,
                  }
                } else {
                  const prJson = JSON.parse(prText) as {
                    html_url?: string
                    number?: number
                  }
                  const status = commitSha
                    ? await postGithubCommitStatus({
                        token,
                        owner: mintOwner,
                        repo: mintRepo,
                        sha: commitSha,
                        state: 'success',
                        context: 'seoranko/github-app-e2e',
                        description: 'App installation token path verified',
                        targetUrl: prJson.html_url,
                      })
                    : { ok: false as const, error: 'no commit sha' }
                  body.e2eNoop = {
                    ok: true,
                    branch,
                    commitSha,
                    prUrl: prJson.html_url ?? null,
                    prNumber: prJson.number ?? null,
                    commitStatus: status,
                    authPath: 'github_app_installation_token',
                    patUsed: false,
                  }
                }
              }
            }
          }
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

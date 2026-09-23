/**
 * Resolve short-lived GitHub App installation tokens for a target repo.
 * Never persists the token. Prefer repo-scoped mint when the repo name is known.
 */

import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { createGithubAppJwt, mintInstallationAccessToken } from './auth'
import { loadGithubAppRecord, upsertInstallation } from './store'

export type GithubAppRepoCreds = {
  owner: string
  repo: string
  baseBranch: string
  accessToken: string
  installationId: number
  tokenExpiresAt: string
  repositories: string[]
}

type InstallRow = {
  installation_id: number
  account_login: string
  repository_selection: string | null
  uninstalled_at: string | null
  suspended_at: string | null
}

/**
 * Refresh account_login from GitHub when the DB row is stale ("unknown").
 */
async function refreshInstallationAccount(installationId: number): Promise<{
  login: string
  type: string
  id: number | null
  repositorySelection: string | null
  raw: unknown
} | null> {
  const app = await loadGithubAppRecord()
  if (!app) return null
  const jwt = createGithubAppJwt(app.appId, app.privateKeyPem)
  const res = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'seoranko-github-app',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) return null
  const json = (await res.json()) as {
    account?: { login?: string; type?: string; id?: number }
    repository_selection?: string
  }
  const login = json.account?.login
  if (!login) return null
  await upsertInstallation({
    installationId,
    accountLogin: login,
    accountType: json.account?.type || 'User',
    accountId: json.account?.id ?? null,
    repositorySelection: json.repository_selection ?? null,
    suspendedAt: null,
    uninstalledAt: null,
    raw: json,
  })
  return {
    login,
    type: json.account?.type || 'User',
    id: json.account?.id ?? null,
    repositorySelection: json.repository_selection ?? null,
    raw: json,
  }
}

/**
 * Find an active installation for `owner` and mint a repo-scoped token for `repo`.
 * Returns null when the App is not installed for that account / repo.
 *
 * Also recovers rows whose account_login was left as "unknown" (OAuth callback
 * overwrite) by refreshing from GET /app/installations/{id}.
 */
export async function resolveGithubAppRepoCreds(input: {
  owner: string
  repo: string
  baseBranch?: string
}): Promise<GithubAppRepoCreds | null> {
  const owner = input.owner.trim()
  const repo = input.repo.trim()
  if (!owner || !repo) return null

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('github_installations')
    .select('installation_id, account_login, repository_selection, uninstalled_at, suspended_at')
    .is('uninstalled_at', null)
    .is('suspended_at', null)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (error || !data?.length) return null

  const rows = data as InstallRow[]
  const ownerLower = owner.toLowerCase()

  // Prefer exact account match; include "unknown" stubs for refresh.
  const ranked = [
    ...rows.filter((r) => String(r.account_login).toLowerCase() === ownerLower),
    ...rows.filter((r) => String(r.account_login).toLowerCase() === 'unknown'),
    ...rows.filter(
      (r) =>
        String(r.account_login).toLowerCase() !== ownerLower &&
        String(r.account_login).toLowerCase() !== 'unknown',
    ),
  ]

  const tried = new Set<number>()
  for (const row of ranked) {
    const installationId = Number(row.installation_id)
    if (!Number.isFinite(installationId) || tried.has(installationId)) continue
    tried.add(installationId)

    let login = String(row.account_login)
    if (login.toLowerCase() === 'unknown' || login.toLowerCase() !== ownerLower) {
      const refreshed = await refreshInstallationAccount(installationId)
      if (refreshed) login = refreshed.login
    }
    if (login.toLowerCase() !== ownerLower) continue

    try {
      const minted = await mintInstallationAccessToken({
        installationId,
        repositories: [repo],
      })

      const fullName = `${owner}/${repo}`.toLowerCase()
      const scoped = minted.repositories.map((r) => r.toLowerCase())
      if (
        scoped.length > 0 &&
        !scoped.includes(fullName) &&
        !scoped.includes(repo.toLowerCase())
      ) {
        continue
      }

      return {
        owner,
        repo,
        baseBranch: input.baseBranch || 'main',
        accessToken: minted.token,
        installationId,
        tokenExpiresAt: minted.expiresAt,
        repositories: minted.repositories,
      }
    } catch {
      continue
    }
  }

  return null
}

/**
 * Sync all App installations from GitHub into github_installations.
 * Used by owner health ?repair_installs=1 after webhook/OAuth left stale rows.
 */
export async function syncGithubAppInstallationsFromApi(): Promise<{
  synced: number
  installations: Array<{
    installationId: number
    accountLogin: string
    repositorySelection: string | null
  }>
}> {
  const app = await loadGithubAppRecord()
  if (!app) throw new Error('GitHub App is not configured')
  const jwt = createGithubAppJwt(app.appId, app.privateKeyPem)
  const res = await fetch('https://api.github.com/app/installations?per_page=100', {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'seoranko-github-app',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`List installations failed (${res.status}): ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as
    | Array<{
        id: number
        account?: { login?: string; type?: string; id?: number }
        repository_selection?: string
        suspended_at?: string | null
      }>
    | {
        installations?: Array<{
          id: number
          account?: { login?: string; type?: string; id?: number }
          repository_selection?: string
          suspended_at?: string | null
        }>
      }
  const list = Array.isArray(json) ? json : json.installations || []
  const out: Array<{
    installationId: number
    accountLogin: string
    repositorySelection: string | null
  }> = []
  for (const inst of list) {
    const login = inst.account?.login || 'unknown'
    await upsertInstallation({
      installationId: Number(inst.id),
      accountLogin: login,
      accountType: inst.account?.type || 'User',
      accountId: inst.account?.id ?? null,
      repositorySelection: inst.repository_selection ?? null,
      suspendedAt: inst.suspended_at ?? null,
      uninstalledAt: null,
      raw: inst,
    })
    out.push({
      installationId: Number(inst.id),
      accountLogin: login,
      repositorySelection: inst.repository_selection ?? null,
    })
  }
  return { synced: out.length, installations: out }
}

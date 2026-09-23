/**
 * Resolve short-lived GitHub App installation tokens for a target repo.
 * Never persists the token. Prefer repo-scoped mint when the repo name is known.
 */

import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { mintInstallationAccessToken } from './auth'

export type GithubAppRepoCreds = {
  owner: string
  repo: string
  baseBranch: string
  accessToken: string
  installationId: number
  tokenExpiresAt: string
  repositories: string[]
}

/**
 * Find an active installation for `owner` and mint a repo-scoped token for `repo`.
 * Returns null when the App is not installed for that account / repo.
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
    .ilike('account_login', owner)
    .is('uninstalled_at', null)
    .is('suspended_at', null)
    .order('updated_at', { ascending: false })
    .limit(5)

  if (error || !data?.length) return null

  const installationId = Number(data[0]!.installation_id)
  if (!Number.isFinite(installationId)) return null

  const minted = await mintInstallationAccessToken({
    installationId,
    repositories: [repo],
  })

  const fullName = `${owner}/${repo}`.toLowerCase()
  const scoped = minted.repositories.map((r) => r.toLowerCase())
  if (scoped.length > 0 && !scoped.includes(fullName) && !scoped.includes(repo.toLowerCase())) {
    throw new Error(
      `Installation token not restricted to ${owner}/${repo} (got: ${minted.repositories.join(', ') || 'none'})`,
    )
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
}

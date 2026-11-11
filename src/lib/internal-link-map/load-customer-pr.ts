/**
 * Best-effort GitHub PR state for Approvals. Never merges or closes PRs.
 */

import { findOwnedSiteConnection } from '@/lib/site-connection-lookup'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { resolveGithubAppRepoCreds } from '@/lib/github-app/resolve-repo-creds'
import { createLiveGithubOps, type GithubPrCreds } from '@/lib/fix-strategies/findings-ui/fix-run/github-ops'
import {
  parseGithubPullUrl,
  type CustomerPrState,
} from './customer-pr'

async function credsForDomain(
  userId: string,
  domain: string,
): Promise<GithubPrCreds | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return null
  const supabase = createServiceRoleClient()
  const owned = await findOwnedSiteConnection(supabase, userId, `https://${domain}`)
  if (!owned || owned.cmsType !== 'github') return null
  const owner = String(owned.credentials.owner || owned.credentials.github_owner || '')
  const repo = String(owned.credentials.repo || owned.credentials.github_repo || '')
  const baseBranch = String(
    owned.credentials.branch || owned.credentials.baseBranch || 'main',
  )
  if (!owner || !repo) return null
  try {
    const app = await resolveGithubAppRepoCreds({
      owner,
      repo,
      baseBranch,
      userId,
    })
    if (app?.accessToken) {
      return {
        owner: app.owner,
        repo: app.repo,
        baseBranch: app.baseBranch || baseBranch,
        accessToken: app.accessToken,
      }
    }
  } catch {
    /* fall through */
  }
  const token = String(
    owned.credentials.accessToken ||
      owned.credentials.token ||
      owned.credentials.github_token ||
      '',
  )
  if (!token) return null
  return { owner, repo, baseBranch, accessToken: token }
}

export async function safeLoadCustomerPrStates(input: {
  userId: string
  domain: string
  prUrls: string[]
}): Promise<Map<string, CustomerPrState>> {
  const out = new Map<string, CustomerPrState>()
  const unique = [...new Set(input.prUrls.filter(Boolean))]
  if (unique.length === 0) return out
  try {
    const base = await credsForDomain(input.userId, input.domain)
    if (!base) return out
    const ops = createLiveGithubOps()
    if (!ops.getPullRequest) return out
    for (const url of unique) {
      const parsed = parseGithubPullUrl(url)
      if (!parsed) continue
      const creds: GithubPrCreds = {
        ...base,
        owner: parsed.owner,
        repo: parsed.repo,
      }
      const pr = await ops.getPullRequest({
        creds,
        prNumber: parsed.prNumber,
      })
      if (!pr.ok) continue
      out.set(url, {
        state: pr.state,
        merged: pr.merged,
        mergedAt: pr.mergedAt ?? null,
      })
    }
  } catch {
    return out
  }
  return out
}

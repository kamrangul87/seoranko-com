/**
 * Recheck failed Fix PRs (merged → verify live / receipt; closed → dismiss).
 * Called from the existing heartbeat. Never merges a customer PR.
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getFixRunStore } from './store'
import { tickFixRun, defaultTickDeps } from './tick'
import { createLiveGithubOps } from './github-ops'
import { findOwnedSiteConnection } from '@/lib/site-connection-lookup'
import { resolveGithubAppRepoCreds } from '@/lib/github-app/resolve-repo-creds'
import type { GithubPrCreds } from './github-ops'

export type PrRecoveryState = 'merged' | 'closed' | 'open' | 'unknown'

export function classifyPrForReceiptRecovery(pr: {
  ok: boolean
  merged?: boolean
  state?: string
}): PrRecoveryState {
  if (!pr.ok) return 'unknown'
  if (pr.merged) return 'merged'
  if (pr.state === 'closed') return 'closed'
  return 'open'
}

export type StalePrRecoveryResult = {
  checked: number
  recovered: string[]
  dismissed: string[]
  skipped: number
  errors: string[]
}

async function resolveCreds(
  userId: string,
  domain: string,
): Promise<GithubPrCreds | null> {
  const supabase = createServiceRoleClient()
  const owned = await findOwnedSiteConnection(
    supabase,
    userId,
    `https://${domain}`,
  )
  if (!owned || owned.cmsType !== 'github') return null
  const owner = String(
    owned.credentials.owner || owned.credentials.github_owner || '',
  )
  const repo = String(
    owned.credentials.repo || owned.credentials.github_repo || '',
  )
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

/**
 * Heartbeat pass: recheck old failed Fix PRs so Recover receipts is only a fallback.
 */
export async function recoverStaleFixReceipts(opts?: {
  limit?: number
}): Promise<StalePrRecoveryResult> {
  const result: StalePrRecoveryResult = {
    checked: 0,
    recovered: [],
    dismissed: [],
    skipped: 0,
    errors: [],
  }
  const sb = createServiceRoleClient()
  const { data: rows, error } = await sb
    .from('fix_strategies_runs')
    .select(
      'id, user_id, site_id, status, phase, pr_number, pr_url, summary, closed_by_customer',
    )
    .not('pr_number', 'is', null)
    .eq('status', 'failed')
    .or('closed_by_customer.is.null,closed_by_customer.eq.false')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 2)
  if (error) {
    result.errors.push(error.message)
    return result
  }

  const store = getFixRunStore()
  const ops = createLiveGithubOps()

  for (const row of rows || []) {
    const runId = String(row.id)
    const userId = String(row.user_id || '')
    const siteId = String(row.site_id || '')
    const prNumber = Number(row.pr_number)
    if (!userId || !siteId || !Number.isFinite(prNumber)) {
      result.skipped += 1
      continue
    }
    const verifiedLive = Number(
      (row.summary as { verifiedLive?: number } | null)?.verifiedLive ?? 0,
    )
    if (verifiedLive > 0) {
      result.skipped += 1
      continue
    }
    result.checked += 1

    const { data: site } = await sb
      .from('connected_sites')
      .select('domain')
      .eq('id', siteId)
      .maybeSingle()
    const domain = String(site?.domain || '')
    if (!domain || !ops.getPullRequest) {
      result.skipped += 1
      continue
    }
    const creds = await resolveCreds(userId, domain)
    if (!creds) {
      result.skipped += 1
      continue
    }

    let pr: Awaited<ReturnType<NonNullable<typeof ops.getPullRequest>>>
    try {
      pr = await ops.getPullRequest({ creds, prNumber })
    } catch (err) {
      result.errors.push(
        `${runId}: ${err instanceof Error ? err.message : 'PR lookup failed'}`,
      )
      continue
    }
    const state = classifyPrForReceiptRecovery(pr)
    const run = await store.getRun(runId, userId)
    if (!run) {
      result.skipped += 1
      continue
    }

    if (state === 'closed') {
      run.closedByCustomer = true
      run.phase = 'done'
      run.status = 'complete'
      await store.saveRun(run, { caller: 'heartbeat:recover_closed' })
      result.dismissed.push(runId)
      continue
    }

    if (state !== 'merged') {
      result.skipped += 1
      continue
    }

    run.mergedByCustomer = true
    run.mergedAt = pr.ok ? pr.mergedAt || new Date().toISOString() : new Date().toISOString()
    run.mergeSha = pr.ok ? pr.mergedSha || run.mergeSha : run.mergeSha
    run.phase = 'verify_production_next'
    run.status = 'running'
    run.errorDetail = null
    await store.saveRun(run, { caller: 'heartbeat:recover_merged' })

    let current = run
    try {
      for (let i = 0; i < 20; i++) {
        const t = await tickFixRun({
          runId: current.id,
          userId,
          deps: defaultTickDeps({
            ops,
            creds,
            siteOrigin: `https://${domain}`,
          }),
        })
        current = t.run
        if (
          current.phase === 'done' ||
          current.status === 'complete' ||
          current.status === 'failed'
        ) {
          break
        }
      }
      result.recovered.push(runId)
    } catch (err) {
      result.errors.push(
        `${runId}: ${err instanceof Error ? err.message : 'recover tick failed'}`,
      )
    }
  }

  return result
}

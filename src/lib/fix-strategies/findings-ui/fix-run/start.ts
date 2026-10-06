/**
 * Start a one-run Fix Agent batch for a site.
 */

import { getFindingsStore } from '../crawl/store'
import type { PersistedFindingRow } from '../crawl/constants'
import {
  isCommitableFinding,
  orderFindingsForApply,
} from './apply-registry'
import { getFixRunStore } from './store'
import type { FixRun } from './types'
import type { GithubOps, GithubPrCreds } from './github-ops'

export type StartFixRunResult =
  | { ok: true; run: FixRun }
  | { ok: false; error: string; code?: string }

export async function selectAutoFixableFindings(
  siteId: string,
): Promise<PersistedFindingRow[]> {
  const store = getFindingsStore()
  const rows = await store.listFindings({
    siteId,
    includeInformational: false,
  })
  const open = rows.filter(
    (r) =>
      r.bucket === 'actionable' &&
      isCommitableFinding(r) &&
      r.postFixStatus !== 'verified',
  )
  return orderFindingsForApply(open)
}

export function makeRunBranchName(siteDomain: string): string {
  const short = siteDomain
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .slice(0, 32)
  return `seoranko/fix-run-${short}-${Date.now().toString(36)}`
}

export async function startFixRun(input: {
  userId: string
  siteId: string
  siteDomain: string
  githubConnected: boolean
  creds?: GithubPrCreds | null
  ops?: GithubOps
}): Promise<StartFixRunResult> {
  if (!input.githubConnected) {
    return {
      ok: false,
      error: 'Connect GitHub for this site before running Fix my site.',
      code: 'github_not_connected',
    }
  }

  const runStore = getFixRunStore()
  const active = await runStore.listActiveForSite(input.siteId, input.userId)
  if (active) {
    return { ok: true, run: active }
  }

  const findings = await selectAutoFixableFindings(input.siteId)
  if (findings.length === 0) {
    return {
      ok: false,
      error: 'No auto-fixable findings ready for this site.',
      code: 'no_fixes',
    }
  }

  const branchName = makeRunBranchName(input.siteDomain)
  const run = await runStore.createRun({
    userId: input.userId,
    siteId: input.siteId,
    findingIds: findings.map((f) => f.id),
    branchName,
  })

  console.info('[fix-run] started', {
    runId: run.id,
    siteId: input.siteId,
    findingIds: findings.map((f) => f.id),
    branchName,
  })

  return { ok: true, run }
}

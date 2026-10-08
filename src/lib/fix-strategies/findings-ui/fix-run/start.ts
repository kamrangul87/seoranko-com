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
  | {
      ok: false
      error: string
      code?: string
      /** Present when code === already_in_progress so the UI can link to it. */
      run?: FixRun
    }

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
    return {
      ok: false,
      error: 'A fix run is already in progress',
      code: 'already_in_progress',
      run: active,
    }
  }

  // Re-resolve when tip blob SHA changed before selecting apply targets.
  try {
    const { resolveSourcesAtRunStart } = await import('./resolve-sources-hook')
    await resolveSourcesAtRunStart({
      siteId: input.siteId,
      userId: input.userId,
      creds: input.creds ?? null,
    })
  } catch (err) {
    console.info('[fix-run] source re-resolve at start failed', {
      siteId: input.siteId,
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  // Select AFTER re-resolve so findings that lost source_path/sha are excluded.
  const findings = (await selectAutoFixableFindings(input.siteId)).filter(
    (f) => Boolean(f.sourcePath && f.sourceBlobSha),
  )
  if (findings.length === 0) {
    return {
      ok: false,
      error: 'No auto-fixable findings with a resolved source file ready for this site.',
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
    sources: findings.map((f) => ({
      id: f.id,
      path: f.sourcePath,
      sha: f.sourceBlobSha,
    })),
  })

  return { ok: true, run }
}

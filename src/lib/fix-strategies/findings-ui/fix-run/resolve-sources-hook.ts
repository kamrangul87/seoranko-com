/**
 * Wire resolveFindingSourcesForSite into crawl completion and Fix Agent start.
 * Logs site id at every branch. No-ops when the site is not GitHub-connected.
 */

import { findOwnedSiteConnection } from '@/lib/site-connection-lookup'
import { createSupabaseJsClient } from '@/lib/supabase/js-client'
import { resolveGithubAppRepoCreds } from '@/lib/github-app/resolve-repo-creds'
import { resolveFindingSourcesForSite } from './resolve-finding-sources'
import type { GithubPrCreds } from './github-ops'

async function resolveCredsForSite(input: {
  siteId: string | null
  userId: string
}): Promise<GithubPrCreds | null> {
  if (!input.siteId) {
    console.info('[resolve-source] skip — no siteId (detect-only)', {
      siteId: null,
      userId: input.userId,
      branch: 'no-site',
    })
    return null
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.info('[resolve-source] skip — supabase env missing', {
      siteId: input.siteId,
      branch: 'no-env',
    })
    return null
  }

  const supabase = createSupabaseJsClient(url, key)
  const { data: site } = await supabase
    .from('connected_sites')
    .select('id, domain')
    .eq('id', input.siteId)
    .eq('user_id', input.userId)
    .maybeSingle()

  if (!site?.domain) {
    console.info('[resolve-source] skip — site not found', {
      siteId: input.siteId,
      branch: 'site-missing',
    })
    return null
  }

  const owned = await findOwnedSiteConnection(
    supabase,
    input.userId,
    `https://${site.domain}`,
  )
  if (!owned || owned.cmsType !== 'github') {
    console.info('[resolve-source] skip — not github-connected', {
      siteId: input.siteId,
      branch: 'not-github',
      cmsType: owned?.cmsType ?? null,
    })
    return null
  }

  const owner = String(
    owned.credentials.owner || owned.credentials.github_owner || '',
  )
  const repo = String(
    owned.credentials.repo || owned.credentials.github_repo || '',
  )
  const baseBranch = String(
    owned.credentials.branch || owned.credentials.baseBranch || 'main',
  )
  if (!owner || !repo) {
    console.info('[resolve-source] skip — missing owner/repo', {
      siteId: input.siteId,
      branch: 'missing-repo',
    })
    return null
  }

  try {
    const app = await resolveGithubAppRepoCreds({
      owner,
      repo,
      baseBranch,
      userId: input.userId,
    })
    if (app?.accessToken) {
      console.info('[resolve-source] creds via github app', {
        siteId: input.siteId,
        branch: 'app-token',
        owner,
        repo,
      })
      return {
        owner,
        repo,
        baseBranch: app.baseBranch || baseBranch,
        accessToken: app.accessToken,
      }
    }
  } catch (err) {
    console.info('[resolve-source] app token failed', {
      siteId: input.siteId,
      branch: 'app-token-error',
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  const token =
    owned.credentials.accessToken ||
    owned.credentials.token ||
    owned.credentials.github_token
  if (!token) {
    console.info('[resolve-source] skip — no token', {
      siteId: input.siteId,
      branch: 'no-token',
    })
    return null
  }

  console.info('[resolve-source] creds via site PAT', {
    siteId: input.siteId,
    branch: 'pat',
    owner,
    repo,
  })
  return { owner, repo, baseBranch, accessToken: String(token) }
}

export type ResolveSourcesAfterCrawlResult = {
  complete: boolean
  lastProcessedFindingId: string | null
  timings?: {
    treeMs: number
    resolveMs: number
    totalMs: number
    targets: number
    fileReads: number
    fileCacheHits: number
  }
}

/** After crawl rollup/upsert — resolve sources for the site (budgeted). */
export async function resolveSourcesAfterCrawl(input: {
  siteId: string | null
  userId: string
  runId: string
  deadlineAt?: number
  startAfterFindingId?: string | null
}): Promise<ResolveSourcesAfterCrawlResult> {
  console.info('[resolve-source] after crawl', {
    siteId: input.siteId,
    runId: input.runId,
    branch: 'after-crawl',
  })
  if (!input.siteId) {
    return { complete: true, lastProcessedFindingId: null }
  }

  // Mint GitHub creds only when there is work — token mint was wasted on
  // sites with zero registered auto-fix transforms.
  const { getFindingsStore } = await import('../crawl/store')
  const { isTransformRegistered } = await import('./apply-registry')
  const { isCurrentlyPresentFindingStatus } = await import('../finding-status')
  const { evidenceNeedleForResolution } = await import('./apply-evidence')
  const store = getFindingsStore()
  const listed = await store.listFindings({
    siteId: input.siteId,
    includeInformational: true,
  })
  const hasTargets = listed.some(
    (f) =>
      isCurrentlyPresentFindingStatus(f.status) &&
      isTransformRegistered(f.topicId, f.verdict) &&
      evidenceNeedleForResolution(f) != null,
  )
  if (!hasTargets) {
    console.info('[resolve-source] no targets (pre-creds)', {
      siteId: input.siteId,
      runId: input.runId,
    })
    return { complete: true, lastProcessedFindingId: null }
  }

  const creds = await resolveCredsForSite({
    siteId: input.siteId,
    userId: input.userId,
  })
  if (!creds) {
    return { complete: true, lastProcessedFindingId: null }
  }

  const result = await resolveFindingSourcesForSite({
    siteId: input.siteId,
    userId: input.userId,
    deps: { creds },
    deadlineAt: input.deadlineAt,
    startAfterFindingId: input.startAfterFindingId,
  })
  return {
    complete: result.complete,
    lastProcessedFindingId: result.lastProcessedFindingId,
    timings: result.timings,
  }
}

/**
 * At Fix Agent run start — re-resolve when blob SHA changed.
 * Call before selectAutoFixableFindings so only path+SHA findings are selected.
 */
export async function resolveSourcesAtRunStart(input: {
  siteId: string
  userId: string
  creds?: GithubPrCreds | null
}): Promise<void> {
  console.info('[resolve-source] at run start', {
    siteId: input.siteId,
    branch: 'run-start',
  })
  const creds =
    input.creds ??
    (await resolveCredsForSite({
      siteId: input.siteId,
      userId: input.userId,
    }))
  if (!creds) return

  await resolveFindingSourcesForSite({
    siteId: input.siteId,
    userId: input.userId,
    deps: { creds },
    onlyIfShaChanged: true,
  })
}

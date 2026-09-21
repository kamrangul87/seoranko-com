/**
 * Findings fix-flow orchestration: approve → PR commit → live verify.
 */

import type { UiFinding, FixFlowState } from '../types'
import type { PersistedFindingRow } from '../crawl/constants'
import {
  getFixFlowStore,
  type FixFlowRecord,
} from './persist'
import {
  applyTopic49AutoSetDimensions,
} from './apply-topic-49'
import {
  commitFileViaPullRequest,
  resolveGithubCredsFromEnv,
  type GithubPrCreds,
} from './github-pr-commit'
import {
  previewPageUrl,
  waitForPrPreviewDeploy,
} from './wait-vercel-deploy'
import { verifyFindingLive } from './verify-live'
import { findOwnedSiteConnection } from '@/lib/site-connection-lookup'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export type CommitContext = {
  /** Explicit GitHub target (operator / E2E). */
  github?: { owner: string; repo: string; baseBranch?: string; accessToken?: string }
  /** Map live page URL → repo path when site adapter match fails. */
  pathOverride?: string
}

async function loadRecord(
  findingId: string,
  userId: string,
): Promise<FixFlowRecord> {
  const store = getFixFlowStore()
  const ui = await store.get(findingId, userId)
  return {
    ...ui,
    userId,
    errorDetail: null,
    updatedAt: new Date().toISOString(),
    commitSha: ui.commitSha ?? null,
    branchName: ui.branchName ?? null,
    prUrl: ui.prUrl ?? null,
    prNumber: ui.prNumber ?? null,
    previewUrl: ui.previewUrl ?? null,
  }
}

export async function getFixFlow(
  findingId: string,
  userId: string,
): Promise<FixFlowState> {
  return getFixFlowStore().get(findingId, userId)
}

export async function approveFix(
  findingId: string,
  userId: string,
): Promise<FixFlowState> {
  const cur = await loadRecord(findingId, userId)
  const next: FixFlowRecord = {
    ...cur,
    step: 'approved',
    approvedAt: new Date().toISOString(),
    commitDetail: null,
    verifyOk: null,
    verifyDetail: null,
    errorDetail: null,
    commitStub: false,
  }
  return getFixFlowStore().save(next)
}

function pathFromPageUrl(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl)
    let path = u.pathname.replace(/^\//, '')
    if (!path || path.endsWith('/')) path = `${path}index.html`.replace(/^\//, '')
    if (!/\.(html?|md|mdx)$/i.test(path)) {
      // Static blog pages often live under public/
      if (!path.includes('.')) path = `${path}.html`
    }
    if (path.startsWith('blog/') || path.startsWith('images/')) {
      return `public/${path}`
    }
    if (!path.startsWith('public/')) {
      return `public/${path}`
    }
    return path
  } catch {
    return null
  }
}

async function resolveGithubCreds(
  userId: string,
  finding: { siteId: string | null; pageUrl: string | null },
  ctx?: CommitContext,
): Promise<GithubPrCreds | null> {
  if (ctx?.github?.accessToken && ctx.github.owner && ctx.github.repo) {
    return {
      owner: ctx.github.owner,
      repo: ctx.github.repo,
      baseBranch: ctx.github.baseBranch || 'main',
      accessToken: ctx.github.accessToken,
    }
  }
  if (ctx?.github?.owner && ctx.github.repo) {
    const fromEnv = resolveGithubCredsFromEnv(ctx.github)
    if (fromEnv) return fromEnv
  }

  // Site connection path (multi-tenant)
  if (
    finding.siteId &&
    finding.pageUrl &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    try {
      const supabase = createServiceRoleClient()
      const owned = await findOwnedSiteConnection(
        supabase,
        userId,
        finding.pageUrl,
      )
      if (
        owned &&
        owned.cmsType === 'github' &&
        owned.credentials.owner &&
        owned.credentials.repo &&
        owned.credentials.accessToken
      ) {
        return {
          owner: String(owned.credentials.owner),
          repo: String(owned.credentials.repo),
          baseBranch: String(owned.credentials.branch || 'main'),
          accessToken: String(owned.credentials.accessToken),
        }
      }
    } catch {
      /* fall through */
    }
  }

  return null
}

async function readRepoFile(
  creds: GithubPrCreds,
  path: string,
): Promise<{ content: string; sha: string } | null> {
  const branch = creds.baseBranch || 'main'
  const res = await fetch(
    `https://api.github.com/repos/${creds.owner}/${creds.repo}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30000),
    },
  )
  if (!res.ok) return null
  const data = (await res.json()) as { content?: string; sha?: string }
  if (!data.content || !data.sha) return null
  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    sha: data.sha,
  }
}

export async function commitFix(input: {
  findingId: string
  userId: string
  finding: UiFinding | PersistedFindingRow
  ctx?: CommitContext
}): Promise<FixFlowState> {
  const { findingId, userId, finding, ctx } = input
  const cur = await loadRecord(findingId, userId)

  if (cur.step !== 'approved' && cur.step !== 'committed') {
    return getFixFlowStore().save({
      ...cur,
      step: 'failed',
      commitStub: false,
      commitDetail: 'Approve before commit',
      errorDetail: 'Approve before commit',
    })
  }

  const pageUrl = finding.pageUrl
  if (!pageUrl) {
    return getFixFlowStore().save({
      ...cur,
      step: 'failed',
      commitStub: false,
      commitDetail: 'Finding has no pageUrl to fix',
      errorDetail: 'Finding has no pageUrl to fix',
    })
  }

  if (finding.topicId !== '49' || finding.verdict !== 'auto-set-dimensions') {
    return getFixFlowStore().save({
      ...cur,
      step: 'failed',
      commitStub: false,
      commitDetail: `Commit not implemented for topic ${finding.topicId} / ${finding.verdict}`,
      errorDetail: `Unsupported topic/verdict for auto-commit`,
    })
  }

  const creds = await resolveGithubCreds(
    userId,
    {
      siteId: 'siteId' in finding ? (finding.siteId as string | null) : null,
      pageUrl,
    },
    ctx,
  )
  if (!creds) {
    return getFixFlowStore().save({
      ...cur,
      step: 'failed',
      commitStub: false,
      commitDetail:
        'No GitHub credentials — connect a GitHub site or set FINDINGS_FIX_GITHUB_TOKEN / GITHUB_TOKEN with explicit owner/repo',
      errorDetail: 'Missing GitHub credentials',
    })
  }

  const path =
    ctx?.pathOverride ||
    pathFromPageUrl(pageUrl) ||
    null
  if (!path) {
    return getFixFlowStore().save({
      ...cur,
      step: 'failed',
      commitStub: false,
      commitDetail: 'Could not map pageUrl to a repo HTML path',
      errorDetail: 'path mapping failed',
    })
  }

  const file = await readRepoFile(creds, path)
  if (!file) {
    return getFixFlowStore().save({
      ...cur,
      step: 'failed',
      commitStub: false,
      commitDetail: `Could not read ${path} from ${creds.owner}/${creds.repo}`,
      errorDetail: 'read failed',
    })
  }

  const applied = await applyTopic49AutoSetDimensions(file.content, pageUrl)
  if (applied.updated === 0) {
    return getFixFlowStore().save({
      ...cur,
      step: 'failed',
      commitStub: false,
      commitDetail: applied.detail,
      errorDetail: applied.detail,
    })
  }

  const short = pageUrl.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40)
  const branchName = `seoranko/fix-49-dims-${short}-${Date.now().toString(36)}`

  const pr = await commitFileViaPullRequest({
    creds,
    path,
    newContent: applied.html,
    branchName,
    commitMessage: `fix(seo): set img width/height on ${path} (topic 49)`,
    prTitle: `fix(seo): topic 49 auto-set-dimensions — ${path}`,
    prBody: [
      '## Summary',
      '',
      'SEORANKO findings fix-flow: set missing `width`/`height` from image file headers.',
      '',
      `- Page: ${pageUrl}`,
      `- File: \`${path}\``,
      `- Images updated: ${applied.applied
        .map((a) => `\`${a.srcAttr}\` → ${a.width}×${a.height}`)
        .join(', ')}`,
      '',
      'Opened as a PR — **not** merged to main. Live verify runs against the Vercel preview deploy.',
    ].join('\n'),
  })

  if (!pr.ok) {
    return getFixFlowStore().save({
      ...cur,
      step: 'failed',
      commitStub: false,
      commitDetail: pr.error,
      errorDetail: pr.error,
    })
  }

  return getFixFlowStore().save({
    ...cur,
    step: 'committed',
    committedAt: new Date().toISOString(),
    commitStub: false,
    commitDetail: pr.skipped
      ? `Already applied on ${pr.branchName}; PR ${pr.prUrl}`
      : `Committed ${applied.detail} on branch ${pr.branchName} → ${pr.prUrl}`,
    commitSha: pr.commitSha,
    branchName: pr.branchName,
    prUrl: pr.prUrl,
    prNumber: pr.prNumber,
    previewUrl: null,
    errorDetail: null,
  })
}

export async function verifyFix(input: {
  findingId: string
  userId: string
  finding: UiFinding | PersistedFindingRow
  ctx?: CommitContext
  /** Skip deploy wait (tests). */
  liveUrlOverride?: string
  timeoutMs?: number
}): Promise<FixFlowState> {
  const { findingId, userId, finding, ctx } = input
  const cur = await loadRecord(findingId, userId)

  if (cur.step !== 'committed' && cur.step !== 'verified') {
    return getFixFlowStore().save({
      ...cur,
      step: 'failed',
      verifyOk: false,
      verifyDetail: 'Commit before verify',
      errorDetail: 'Commit before verify',
    })
  }

  const pageUrl = finding.pageUrl
  if (!pageUrl) {
    return getFixFlowStore().save({
      ...cur,
      step: 'failed',
      verifyOk: false,
      verifyDetail: 'Finding has no pageUrl',
      errorDetail: 'no pageUrl',
    })
  }

  let verifyUrl = input.liveUrlOverride ?? null

  if (!verifyUrl) {
    const creds = await resolveGithubCreds(
      userId,
      {
        siteId: 'siteId' in finding ? (finding.siteId as string | null) : null,
        pageUrl,
      },
      ctx,
    )
    if (!creds || !cur.branchName) {
      return getFixFlowStore().save({
        ...cur,
        step: 'failed',
        verifyOk: false,
        verifyDetail:
          'Cannot wait for deploy — missing GitHub credentials or branch name from commit',
        errorDetail: 'missing deploy context',
      })
    }

    const deploy = await waitForPrPreviewDeploy({
      owner: creds.owner,
      repo: creds.repo,
      branchName: cur.branchName,
      accessToken: creds.accessToken,
      timeoutMs: input.timeoutMs,
    })

    if (!deploy.ok) {
      return getFixFlowStore().save({
        ...cur,
        step: deploy.pending ? 'committed' : 'failed',
        verifyOk: false,
        verifyDetail: deploy.error,
        errorDetail: deploy.error,
      })
    }

    verifyUrl = previewPageUrl(deploy.previewUrl, pageUrl)
    cur.previewUrl = deploy.previewUrl
  }

  const result = await verifyFindingLive({
    topicId: finding.topicId,
    liveUrl: verifyUrl,
  })

  return getFixFlowStore().save({
    ...cur,
    step: result.ok ? 'verified' : 'failed',
    verifiedAt: new Date().toISOString(),
    verifyOk: result.ok,
    verifyDetail: `${result.detail} (url=${result.verifiedUrl})`,
    previewUrl: cur.previewUrl,
    errorDetail: result.ok ? null : result.detail,
  })
}

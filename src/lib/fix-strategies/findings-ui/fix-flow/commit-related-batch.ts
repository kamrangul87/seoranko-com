/**
 * One Fix Agent PR for every selected related-reading finding on a site.
 * Never auto-merges.
 */

import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'
import type { PersistedFindingRow } from '@/lib/fix-strategies/findings-ui/crawl/constants'
import { applyRegisteredTransform } from '@/lib/fix-strategies/findings-ui/fix-run/apply-registry'
import { isFixTypePaused } from '@/lib/fix-strategies/findings-ui/fix-run/failure-learning'
import {
  RELATED_TRANSFORM_VERSION,
  cleanRelatedAnchor,
} from '@/lib/fix-strategies/related-articles/anchors'
import type { RelatedTarget } from '@/lib/fix-strategies/related-articles/fix-add-related'
import {
  relatedReadingPrBody,
  relatedReadingPrTitle,
} from '@/lib/fix-strategies/related-articles/pr-copy'
import { withCustomerWriteGate } from '@/lib/customer-write-gate'
import { assertFixWriteEntitled } from '@/lib/stripe/entitlements'
import { isRelatedReadingFinding } from '@/lib/internal-link-map/approvals'
import {
  approveFix,
  resolveGithubCreds,
  type CommitContext,
} from './orchestrate'
import {
  commitFilesViaPullRequest,
  type GithubPrCreds,
} from './github-pr-commit'
import { getFixFlowStore, type FixFlowRecord } from './persist'
import {
  blockedFixMessage,
  ensureFindingReadyForFix,
} from './prepare-registered-fix'

export type RelatedBatchItemResult = {
  id: string
  ok: boolean
  error?: string
  prUrl?: string | null
  prNumber?: number | null
}

export type RelatedBatchResult = {
  ok: boolean
  error?: string
  prUrl: string | null
  prNumber: number | null
  items: RelatedBatchItemResult[]
  merged: false
}

function relatedTargetsOf(row: PersistedFindingRow): RelatedTarget[] {
  const ev = (row.evidenceValues || {}) as Record<string, unknown>
  const raw = ev.relatedTargets
  if (!Array.isArray(raw)) return []
  return (raw as RelatedTarget[]).filter(
    (t) => t && typeof t.href === 'string' && typeof t.anchorText === 'string',
  )
}

async function stampRelatedVersion(row: PersistedFindingRow): Promise<void> {
  await getFindingsStore().updateFindingSourceResolution({
    findingId: row.id,
    sourcePath: row.sourcePath,
    sourceBlobSha: row.sourceBlobSha,
    sourceResolvedAt: row.sourceResolvedAt,
    sourceUnresolvedReason: row.sourceUnresolvedReason,
    evidenceValues: {
      ...(row.evidenceValues || {}),
      relatedTransformVersion: RELATED_TRANSFORM_VERSION,
      neverAutoMerge: true,
      requiresApproval: true,
    },
  })
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

function failAll(
  findings: PersistedFindingRow[],
  error: string,
): RelatedBatchResult {
  return {
    ok: false,
    error,
    prUrl: null,
    prNumber: null,
    merged: false,
    items: findings.map((f) => ({ id: f.id, ok: false, error })),
  }
}

export async function commitRelatedFindingsBatch(input: {
  userId: string
  email?: string | null
  findings: PersistedFindingRow[]
  ctx?: CommitContext
}): Promise<RelatedBatchResult> {
  const { userId, email, ctx } = input
  const findings = input.findings.filter(isRelatedReadingFinding)
  if (findings.length === 0) {
    return failAll(input.findings, 'No related reading findings to approve')
  }

  const entitled = await assertFixWriteEntitled({ userId, email })
  if (!entitled.ok) {
    return failAll(findings, entitled.error)
  }

  const prepared: PersistedFindingRow[] = []
  const prepErrors = new Map<string, string>()
  for (const row of findings) {
    const paused = await isFixTypePaused(row.topicId, row.verdict)
    const ready = await ensureFindingReadyForFix({ row, userId, ctx })
    if (ready.patch) {
      await getFindingsStore().updateFindingSourceResolution({
        findingId: row.id,
        ...ready.patch,
      })
    }
    const blocked = blockedFixMessage(ready.row, paused)
    if (blocked) {
      prepErrors.set(row.id, blocked)
      continue
    }
    prepared.push(ready.row)
    await approveFix(row.id, userId)
  }

  if (prepared.length === 0) {
    return {
      ok: false,
      error: [...prepErrors.values()][0] || 'Nothing to commit',
      prUrl: null,
      prNumber: null,
      merged: false,
      items: findings.map((f) => ({
        id: f.id,
        ok: false,
        error: prepErrors.get(f.id) || 'Nothing to commit',
      })),
    }
  }

  const creds = await resolveGithubCreds(
    userId,
    { siteId: prepared[0]!.siteId, pageUrl: prepared[0]!.pageUrl },
    ctx,
  )
  if (!creds) {
    const error =
      'No GitHub credentials — connect a GitHub site or set FINDINGS_FIX_GITHUB_TOKEN / GITHUB_TOKEN with explicit owner/repo'
    return failAll(findings, error)
  }

  const files: Array<{
    path: string
    newContent: string
    row: PersistedFindingRow
  }> = []
  const applyErrors = new Map<string, string>()
  const contentsByPath = new Map<string, string>()

  for (const row of prepared) {
    const path = row.sourcePath
    if (!path || !row.sourceBlobSha) {
      applyErrors.set(row.id, 'source unresolved')
      continue
    }
    let content = contentsByPath.get(path)
    if (content == null) {
      const file = await readRepoFile(creds, path)
      if (!file) {
        applyErrors.set(row.id, `Could not read ${path}`)
        continue
      }
      content = file.content
    }
    const applied = await applyRegisteredTransform({
      fileContent: content,
      path,
      finding: row,
    })
    if (!applied.ok) {
      applyErrors.set(row.id, applied.error)
      continue
    }
    if (applied.noop || applied.updated === 0) {
      applyErrors.set(row.id, `Transform made no change to ${path}`)
      continue
    }
    contentsByPath.set(path, applied.newContent)
    const existing = files.find((f) => f.path === path)
    if (existing) {
      existing.newContent = applied.newContent
      existing.row = row
    } else {
      files.push({ path, newContent: applied.newContent, row })
    }
  }

  if (files.length === 0) {
    return {
      ok: false,
      error: [...applyErrors.values()][0] || 'Transform made no change',
      prUrl: null,
      prNumber: null,
      merged: false,
      items: findings.map((f) => ({
        id: f.id,
        ok: false,
        error: prepErrors.get(f.id) || applyErrors.get(f.id) || 'Nothing to commit',
      })),
    }
  }

  const prRows = files.map((f) => ({
    sourcePath: f.path,
    sourceUrl: f.row.pageUrl,
    targets: relatedTargetsOf(f.row).map((t) => ({
      href: t.href,
      anchorText: cleanRelatedAnchor({
        h1: t.h1,
        title: t.title,
        href: t.href,
        stored: t.anchorText,
        anchorText: t.anchorText,
      }),
      reason: f.row.detail || 'Related reading',
    })),
  }))

  const branchName = `seoranko/related-reading-${Date.now().toString(36)}`
  const pr = await withCustomerWriteGate('findings-pr-branch', { approved: true }, () =>
    commitFilesViaPullRequest({
      creds,
      files: files.map((f) => ({ path: f.path, newContent: f.newContent })),
      branchName,
      commitMessage: relatedReadingPrTitle(files.length),
      prTitle: relatedReadingPrTitle(files.length),
      prBody: relatedReadingPrBody(prRows),
    }),
  )

  if (!pr.ok) {
    return failAll(findings, pr.error)
  }

  const now = new Date().toISOString()
  const appliedIds = new Set(files.map((f) => f.row.id))
  // Same-path later findings still succeeded if contentsByPath was updated.
  for (const row of prepared) {
    if (applyErrors.has(row.id) || prepErrors.has(row.id)) continue
    if (!row.sourcePath || !contentsByPath.has(row.sourcePath)) continue
    appliedIds.add(row.id)
    const cur = (await getFixFlowStore().get(row.id, userId)) as FixFlowRecord
    await getFixFlowStore().save({
      ...cur,
      userId,
      errorDetail: null,
      updatedAt: now,
      step: 'committed',
      committedAt: now,
      commitStub: false,
      commitDetail: `Committed related reading on branch ${pr.branchName} → ${pr.prUrl}`,
      commitSha: pr.commitSha,
      branchName: pr.branchName,
      prUrl: pr.prUrl,
      prNumber: pr.prNumber,
      previewUrl: null,
    })
    await stampRelatedVersion(row)
  }

  return {
    ok: true,
    prUrl: pr.prUrl,
    prNumber: pr.prNumber,
    merged: false,
    items: findings.map((f) => {
      if (appliedIds.has(f.id)) {
        return { id: f.id, ok: true, prUrl: pr.prUrl, prNumber: pr.prNumber }
      }
      return {
        id: f.id,
        ok: false,
        error: prepErrors.get(f.id) || applyErrors.get(f.id) || 'Not included',
      }
    }),
  }
}

/**
 * Promote a registered mechanical finding into the per-finding fix flow.
 * Link-map / GSC related-articles rows persist as surfaceClass=finding until
 * resolveSourceFile stores path + blob SHA (same as Audit crawl rollup).
 */

import type { PersistedFindingRow } from '../crawl/constants'
import { canOfferFix, FIX_TYPE_PAUSED_OWNER_COPY } from '../buckets'
import type { FindingSurfaceClass } from '../types'
import { isTransformRegistered } from '../fix-run/apply-registry'
import {
  resolveOneFindingSource,
  fetchRepoTree,
  type FindingSourcePatch,
} from '../fix-run/resolve-finding-sources'
import { whySourceUnresolved } from '../fix-run/resolve-source-file'
import { resolveGithubCreds, type CommitContext } from './orchestrate'

const NOT_AUTO_FIXABLE =
  'This finding is not auto-fixable. Human-review and report-only findings cannot enter the fix flow.'

export function isRegisteredMechanicalFix(row: PersistedFindingRow): boolean {
  if (row.reportOnly) return false
  if (
    row.verdict.startsWith('human-review') ||
    row.verdict.startsWith('observation-')
  ) {
    return false
  }
  if (!/^auto[-_]/.test(row.verdict)) return false
  return isTransformRegistered(row.topicId, row.verdict)
}

export function shouldResolveBeforeFix(row: PersistedFindingRow): boolean {
  if (!isRegisteredMechanicalFix(row)) return false
  if (
    row.sourcePath &&
    row.sourceBlobSha &&
    row.surfaceClass === 'auto-fixable'
  ) {
    return false
  }
  return true
}

export function applySourcePatch(
  row: PersistedFindingRow,
  patch: FindingSourcePatch,
): PersistedFindingRow {
  return {
    ...row,
    sourcePath: patch.sourcePath,
    sourceBlobSha: patch.sourceBlobSha,
    sourceResolvedAt: patch.sourceResolvedAt,
    sourceUnresolvedReason: patch.sourceUnresolvedReason,
    autoFixable: patch.autoFixable ?? row.autoFixable,
    surfaceClass: patch.surfaceClass ?? row.surfaceClass,
    evidenceValues: patch.evidenceValues ?? row.evidenceValues,
    verdict: patch.verdict ?? row.verdict,
  }
}

export function blockedFixMessage(
  row: PersistedFindingRow,
  paused: boolean,
): string | null {
  if (paused) return FIX_TYPE_PAUSED_OWNER_COPY
  if (canOfferFix(row.surfaceClass as FindingSurfaceClass)) return null
  if (row.sourceUnresolvedReason) {
    return whySourceUnresolved(
      row.sourceUnresolvedReason as Parameters<typeof whySourceUnresolved>[0],
    )
  }
  return NOT_AUTO_FIXABLE
}

export async function resolveRegisteredFindingSource(input: {
  row: PersistedFindingRow
  listTree: () => Promise<Array<{ path: string; sha: string }>>
  readFile: (path: string) => Promise<string | null>
}): Promise<FindingSourcePatch> {
  const tree = await input.listTree()
  const treeShas: Record<string, string> = {}
  for (const e of tree) {
    if (e.sha) treeShas[e.path] = e.sha
  }
  return resolveOneFindingSource({
    siteId: input.row.siteId || '',
    finding: input.row,
    tree,
    treeShas,
    readFile: input.readFile,
  })
}

async function readGithubFile(
  creds: { owner: string; repo: string; baseBranch?: string; accessToken: string },
  path: string,
): Promise<string | null> {
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
      signal: AbortSignal.timeout(20000),
    },
  )
  if (!res.ok) return null
  const data = (await res.json()) as { content?: string }
  if (!data.content) return null
  return Buffer.from(data.content, 'base64').toString('utf-8')
}

export async function ensureFindingReadyForFix(input: {
  row: PersistedFindingRow
  userId: string
  ctx?: CommitContext
}): Promise<{ row: PersistedFindingRow; patch: FindingSourcePatch | null }> {
  if (!shouldResolveBeforeFix(input.row)) {
    return { row: input.row, patch: null }
  }
  const creds = await resolveGithubCreds(
    input.userId,
    { siteId: input.row.siteId, pageUrl: input.row.pageUrl },
    input.ctx,
  )
  if (!creds) return { row: input.row, patch: null }
  const patch = await resolveRegisteredFindingSource({
    row: input.row,
    listTree: () => fetchRepoTree(creds),
    readFile: (path) => readGithubFile(creds, path),
  })
  return { row: applySourcePatch(input.row, patch), patch }
}

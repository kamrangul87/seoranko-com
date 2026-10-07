/**
 * Run source-file resolution for GitHub-connected site findings.
 * Used after crawl (resumable post-crawl phase) and at Fix Agent run start.
 */

import type { PersistedFindingRow } from '../crawl/constants'
import { getFindingsStore } from '../crawl/store'
import {
  evidenceNeedleForResolution,
  resolutionUrlForFinding,
} from './apply-evidence'
import {
  resolveSourceFile,
  whySourceUnresolved,
  type SourceUnresolvedReason,
} from './resolve-source-file'
import type { GithubPrCreds } from './github-ops'

/** Verdicts that may become auto-fixable once a source path+SHA is stored. */
function verdictLooksAuto(verdict: string): boolean {
  return /^auto[-_]/.test(verdict)
}

const GH = 'https://api.github.com'

export type RepoTreeEntry = { path: string; sha: string }

export type ResolveFindingSourcesDeps = {
  creds: GithubPrCreds
  /** Injectable tree fetch for tests. */
  listTree?: (creds: GithubPrCreds) => Promise<RepoTreeEntry[]>
  /** Injectable file read for tests. */
  readFile?: (
    creds: GithubPrCreds,
    path: string,
    ref: string,
  ) => Promise<string | null>
  now?: () => string
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export async function fetchRepoTree(
  creds: GithubPrCreds,
): Promise<RepoTreeEntry[]> {
  const branch = creds.baseBranch || 'main'
  const res = await fetch(
    `${GH}/repos/${creds.owner}/${creds.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    {
      headers: ghHeaders(creds.accessToken),
      signal: AbortSignal.timeout(30000),
    },
  )
  if (!res.ok) return []
  const data = (await res.json()) as {
    tree?: Array<{ path?: string; sha?: string; type?: string }>
  }
  return (data.tree || [])
    .filter((f) => f.type === 'blob' && typeof f.path === 'string')
    .map((f) => ({ path: f.path!, sha: String(f.sha ?? '') }))
}

async function readRepoFileContent(
  creds: GithubPrCreds,
  path: string,
  ref: string,
): Promise<string | null> {
  const res = await fetch(
    `${GH}/repos/${creds.owner}/${creds.repo}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?ref=${encodeURIComponent(ref)}`,
    {
      headers: ghHeaders(creds.accessToken),
      signal: AbortSignal.timeout(20000),
    },
  )
  if (!res.ok) return null
  const data = (await res.json()) as { content?: string; encoding?: string }
  if (!data.content) return null
  return Buffer.from(data.content, 'base64').toString('utf-8')
}

export type FindingSourcePatch = {
  sourcePath: string | null
  sourceBlobSha: string | null
  sourceResolvedAt: string | null
  sourceUnresolvedReason: SourceUnresolvedReason | null
  /** Demote from auto-fixable when unresolved. */
  autoFixable?: boolean
  surfaceClass?: string
  evidenceValues?: Record<string, unknown> | null
}

/**
 * Resolve one finding against the current tree. Logs site id + finding id
 * at every branch (acceptance requirement).
 */
export async function resolveOneFindingSource(input: {
  siteId: string
  finding: PersistedFindingRow
  tree: RepoTreeEntry[]
  treeShas: Record<string, string>
  readFile: (path: string) => Promise<string | null>
}): Promise<FindingSourcePatch> {
  const { siteId, finding, tree, treeShas, readFile } = input
  const logBase = { siteId, findingId: finding.id, topicId: finding.topicId }

  const url = resolutionUrlForFinding(finding)
  const evidence = evidenceNeedleForResolution(finding)

  if (!url || !evidence) {
    console.info('[resolve-source] unresolved', {
      ...logBase,
      branch: 'no-evidence',
      reason: 'evidence-not-found',
    })
    return demoteUnresolved(finding, 'evidence-not-found')
  }

  console.info('[resolve-source] attempt', {
    ...logBase,
    branch: 'attempt',
    url,
    needleLen: evidence.needle.length,
    expectedCount: evidence.expectedCount,
  })

  const result = await resolveSourceFile({
    url,
    evidence,
    treePaths: tree.map((t) => t.path),
    treeShas,
    readFile,
  })

  if (result.status === 'resolved') {
    console.info('[resolve-source] resolved', {
      ...logBase,
      branch: 'resolved',
      path: result.path,
      blobSha: result.blobSha,
    })
    const ev = { ...(finding.evidenceValues ?? {}) }
    delete ev.sourceUnresolvedWhy
    // Promote when the verdict is an auto-* mechanical fix and not report-only.
    // isCommitableFinding still requires a registered transform + path+SHA.
    const canAuto = verdictLooksAuto(finding.verdict) && !finding.reportOnly
    return {
      sourcePath: result.path,
      sourceBlobSha: result.blobSha,
      sourceResolvedAt: result.resolvedAt,
      sourceUnresolvedReason: null,
      autoFixable: canAuto ? true : finding.autoFixable,
      surfaceClass: canAuto ? 'auto-fixable' : finding.surfaceClass,
      evidenceValues: ev,
    }
  }

  console.info('[resolve-source] unresolved', {
    ...logBase,
    branch: 'unresolved',
    reason: result.reason,
    candidates: result.candidates,
  })
  return demoteUnresolved(finding, result.reason)
}

function demoteUnresolved(
  finding: PersistedFindingRow,
  reason: SourceUnresolvedReason,
): FindingSourcePatch {
  const why = whySourceUnresolved(reason)
  const ev = {
    ...(finding.evidenceValues ?? {}),
    sourceUnresolvedWhy: why,
  }
  return {
    sourcePath: null,
    sourceBlobSha: null,
    sourceResolvedAt: new Date().toISOString(),
    sourceUnresolvedReason: reason,
    autoFixable: false,
    // Human-task class — not auto-fixable without a stored path+SHA.
    surfaceClass: 'human-review',
    evidenceValues: ev,
  }
}

/**
 * Re-resolve when the stored blob SHA no longer matches the tree tip.
 */
export function blobShaChanged(
  finding: PersistedFindingRow,
  treeShas: Record<string, string>,
): boolean {
  if (!finding.sourcePath || !finding.sourceBlobSha) return true
  const tip = treeShas[finding.sourcePath]
  if (!tip) return true
  return tip !== finding.sourceBlobSha
}

/**
 * Resolve (or re-resolve) findings for a site after crawl / at run start.
 * Only findings with a registered transform (or topic 49 path) are attempted;
 * others with locatable evidence still get a resolution attempt when listed.
 */
export async function resolveFindingSourcesForSite(input: {
  siteId: string
  userId: string
  findingIds?: string[]
  deps: ResolveFindingSourcesDeps
  /** When true, skip findings whose tip blob SHA still matches. */
  onlyIfShaChanged?: boolean
}): Promise<{ resolved: number; unresolved: number; skipped: number }> {
  const store = getFindingsStore()
  const all = await store.listFindings({
    siteId: input.siteId,
    includeInformational: true,
  })
  const idSet = input.findingIds ? new Set(input.findingIds) : null
  // Lazy import avoids circular init with apply-registry.
  const { isTransformRegistered } = await import('./apply-registry')

  const targets = all.filter((f) => {
    if (idSet && !idSet.has(f.id)) return false
    // Only registered transforms — unresolved stay human-task after demotion.
    if (!isTransformRegistered(f.topicId, f.verdict)) return false
    return evidenceNeedleForResolution(f) != null
  })

  if (targets.length === 0) {
    console.info('[resolve-source] no targets', { siteId: input.siteId })
    return { resolved: 0, unresolved: 0, skipped: 0 }
  }

  const listTree = input.deps.listTree ?? fetchRepoTree
  const readFileFn =
    input.deps.readFile ??
    ((creds, path, ref) => readRepoFileContent(creds, path, ref))

  const tree = await listTree(input.deps.creds)
  const treeShas: Record<string, string> = {}
  for (const e of tree) {
    if (e.sha) treeShas[e.path] = e.sha
  }
  const ref = input.deps.creds.baseBranch || 'main'

  let resolved = 0
  let unresolved = 0
  let skipped = 0

  for (const finding of targets) {
    if (
      input.onlyIfShaChanged &&
      finding.sourcePath &&
      finding.sourceBlobSha &&
      !blobShaChanged(finding, treeShas)
    ) {
      console.info('[resolve-source] skip unchanged sha', {
        siteId: input.siteId,
        findingId: finding.id,
        branch: 'sha-unchanged',
        path: finding.sourcePath,
      })
      skipped++
      continue
    }

    // Force re-resolve when SHA changed (clear stale path first in logs).
    if (finding.sourcePath && blobShaChanged(finding, treeShas)) {
      console.info('[resolve-source] blob sha changed — re-resolve', {
        siteId: input.siteId,
        findingId: finding.id,
        branch: 'sha-changed',
        path: finding.sourcePath,
        storedSha: finding.sourceBlobSha,
        tipSha: treeShas[finding.sourcePath] ?? null,
      })
    }

    const patch = await resolveOneFindingSource({
      siteId: input.siteId,
      finding,
      tree,
      treeShas,
      readFile: (path) => readFileFn(input.deps.creds, path, ref),
    })

    await store.updateFindingSourceResolution({
      findingId: finding.id,
      ...patch,
    })

    if (patch.sourcePath && patch.sourceBlobSha) resolved++
    else unresolved++
  }

  console.info('[resolve-source] site complete', {
    siteId: input.siteId,
    resolved,
    unresolved,
    skipped,
  })
  return { resolved, unresolved, skipped }
}

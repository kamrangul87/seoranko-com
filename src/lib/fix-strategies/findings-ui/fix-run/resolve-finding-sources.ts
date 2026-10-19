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
import { isCreateSourceBlobSha } from './create-source'
import type { GithubPrCreds } from './github-ops'
import { recordFixFailureSafe } from './failure-learning'

/** Shared footer/nav files that can receive an orphan inlink. */
export function candidateNavFooterPaths(treePaths: string[]): string[] {
  return treePaths
    .filter((p) => {
      if (/\.(html?)$/i.test(p) && /(^|\/)public\//i.test(p)) return true
      if (/(^|\/)(Footer|Header|Nav|Navbar|SiteFooter|SiteHeader)\.(tsx|jsx|html?)$/i.test(p)) {
        return true
      }
      if (/(footer|header|navbar)\.(tsx|jsx|html?)$/i.test(p)) return true
      return false
    })
    .sort((a, b) => {
      // Prefer React Footer component, then static HTML under public/.
      const score = (p: string) => {
        if (/Footer\.(tsx|jsx)$/i.test(p)) return 0
        if (/footer\.(tsx|jsx|html?)$/i.test(p)) return 1
        if (/\.html?$/i.test(p)) return 2
        return 3
      }
      const d = score(a) - score(b)
      return d !== 0 ? d : a.localeCompare(b)
    })
}

function orphanHrefFromFinding(finding: PersistedFindingRow): string {
  try {
    return new URL(finding.pageUrl || '').pathname || '/'
  } catch {
    return '/'
  }
}

function pathIsOrphanPageItself(path: string, orphanHref: string): boolean {
  const norm = orphanHref.replace(/\/+$/, '') || ''
  const bare = norm.replace(/^\//, '')
  if (!bare) return /\/index\.html?$/i.test(path) && !path.includes('/')
  return (
    path.includes(`/${bare}/index.html`) ||
    path.endsWith(`/${bare}.html`) ||
    path.endsWith(`/${bare}`)
  )
}

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

  // Topic 43: edit a shared footer/nav on a *different* page (or Footer.tsx),
  // never the orphan page itself.
  if (finding.topicId === '43') {
    const orphanHref = orphanHrefFromFinding(finding)
    const navCandidates = candidateNavFooterPaths(tree.map((t) => t.path)).filter(
      (p) => !pathIsOrphanPageItself(p, orphanHref),
    )
    let chosen: { path: string; sha: string } | null = null
    for (const path of navCandidates) {
      const body = await readFile(path)
      if (body == null) continue
      if (!body.includes(evidence.needle) && !/<footer\b/i.test(body) && !/internalLinks/i.test(body)) {
        continue
      }
      // Prefer a file that does not already link the orphan.
      const already =
        body.includes(`href="${orphanHref}"`) ||
        body.includes(`href='${orphanHref}'`) ||
        body.includes(`path: "${orphanHref}"`) ||
        body.includes(`path: '${orphanHref}'`) ||
        body.includes(`to="${orphanHref}"`) ||
        body.includes(`to='${orphanHref}'`)
      const sha = treeShas[path]
      if (!sha) continue
      if (!already) {
        chosen = { path, sha }
        break
      }
      // Keep first already-linked as fallback (transform will noop).
      if (!chosen) chosen = { path, sha }
    }
    if (chosen) {
      console.info('[resolve-source] resolved', {
        ...logBase,
        branch: 'resolved-nav-footer',
        path: chosen.path,
        blobSha: chosen.sha,
      })
      const ev = { ...(finding.evidenceValues ?? {}) }
      delete ev.sourceUnresolvedWhy
      const canAuto = verdictLooksAuto(finding.verdict) && !finding.reportOnly
      return {
        sourcePath: chosen.path,
        sourceBlobSha: chosen.sha,
        sourceResolvedAt: new Date().toISOString(),
        sourceUnresolvedReason: null,
        autoFixable: canAuto ? true : finding.autoFixable,
        surfaceClass: canAuto ? 'auto-fixable' : finding.surfaceClass,
        evidenceValues: ev,
      }
    }
    console.info('[resolve-source] unresolved', {
      ...logBase,
      branch: 'unresolved-nav-footer',
      reason: 'no-static-file',
      candidates: navCandidates.slice(0, 8),
    })
    return demoteUnresolved(finding, 'no-static-file')
  }

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
      branch: isCreateSourceBlobSha(result.blobSha)
        ? 'resolved-create-static'
        : 'resolved',
      path: result.path,
      blobSha: result.blobSha,
    })
    const ev = { ...(finding.evidenceValues ?? {}) }
    delete ev.sourceUnresolvedWhy
    if (isCreateSourceBlobSha(result.blobSha)) {
      ev.createStaticPage = true
    }
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
  // Ledger resolve-stage failures for mechanical auto-* verdicts only.
  if (/^auto-/.test(finding.verdict)) {
    recordFixFailureSafe({
      siteId: finding.siteId,
      findingId: finding.id,
      topic: finding.topicId,
      verdict: finding.verdict,
      stage: 'resolve',
      reason: `source unresolved: ${reason}`,
      url: finding.pageUrl,
      filePath: finding.sourcePath,
    })
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

/** Soft budget for resolve_sources inside a crawl tick (target <20s). */
export const RESOLVE_SOURCES_BUDGET_MS = 18_000

export type ResolveSourcesTimings = {
  treeMs: number
  resolveMs: number
  totalMs: number
  targets: number
  fileReads: number
  fileCacheHits: number
}

export type ResolveFindingSourcesResult = {
  resolved: number
  unresolved: number
  skipped: number
  /** False when the soft deadline stopped the loop early — caller resumes. */
  complete: boolean
  lastProcessedFindingId: string | null
  timings: ResolveSourcesTimings
}

/**
 * Resolve (or re-resolve) findings for a site after crawl / at run start.
 * Fetches the repo tree once, caches file contents by path, and stops when
 * `deadlineAt` elapses so the crawl tick can release its lease.
 */
export async function resolveFindingSourcesForSite(input: {
  siteId: string
  userId: string
  findingIds?: string[]
  deps: ResolveFindingSourcesDeps
  /** When true, skip findings whose tip blob SHA still matches. */
  onlyIfShaChanged?: boolean
  /** Soft wall-clock deadline (Date.now() ms). */
  deadlineAt?: number
  /** Resume after a prior partial tick (finding ids already handled). */
  startAfterFindingId?: string | null
}): Promise<ResolveFindingSourcesResult> {
  const startedAt = Date.now()
  const deadlineAt =
    input.deadlineAt ?? Date.now() + RESOLVE_SOURCES_BUDGET_MS
  const emptyTimings = (): ResolveSourcesTimings => ({
    treeMs: 0,
    resolveMs: 0,
    totalMs: Date.now() - startedAt,
    targets: 0,
    fileReads: 0,
    fileCacheHits: 0,
  })

  const store = getFindingsStore()
  const all = await store.listFindings({
    siteId: input.siteId,
    includeInformational: true,
  })
  const idSet = input.findingIds ? new Set(input.findingIds) : null
  // Lazy import avoids circular init with apply-registry.
  const { isTransformRegistered } = await import('./apply-registry')
  const { isCurrentlyPresentFindingStatus } = await import('../finding-status')

  let targets = all.filter((f) => {
    if (idSet && !idSet.has(f.id)) return false
    if (!isCurrentlyPresentFindingStatus(f.status)) return false
    // Only registered transforms — unresolved stay human-task after demotion.
    if (!isTransformRegistered(f.topicId, f.verdict)) return false
    return evidenceNeedleForResolution(f) != null
  })
  // Stable order so startAfterFindingId resumes deterministically.
  targets = targets.sort((a, b) => a.id.localeCompare(b.id))
  if (input.startAfterFindingId) {
    const idx = targets.findIndex((f) => f.id === input.startAfterFindingId)
    if (idx >= 0) targets = targets.slice(idx + 1)
  }

  if (targets.length === 0) {
    console.info('[resolve-source] no targets', { siteId: input.siteId })
    return {
      resolved: 0,
      unresolved: 0,
      skipped: 0,
      complete: true,
      lastProcessedFindingId: input.startAfterFindingId ?? null,
      timings: emptyTimings(),
    }
  }

  if (Date.now() >= deadlineAt) {
    console.info('[resolve-source] deadline before tree', {
      siteId: input.siteId,
      targets: targets.length,
    })
    return {
      resolved: 0,
      unresolved: 0,
      skipped: 0,
      complete: false,
      lastProcessedFindingId: input.startAfterFindingId ?? null,
      timings: { ...emptyTimings(), targets: targets.length },
    }
  }

  const listTree = input.deps.listTree ?? fetchRepoTree
  const readFileFn =
    input.deps.readFile ??
    ((creds, path, ref) => readRepoFileContent(creds, path, ref))

  const treeStarted = Date.now()
  const tree = await listTree(input.deps.creds)
  const treeMs = Date.now() - treeStarted
  const treeShas: Record<string, string> = {}
  for (const e of tree) {
    if (e.sha) treeShas[e.path] = e.sha
  }
  const ref = input.deps.creds.baseBranch || 'main'

  // Cache file bodies for the run — many findings share the same static path.
  const fileCache = new Map<string, string | null>()
  let fileReads = 0
  let fileCacheHits = 0
  const cachedRead = async (path: string): Promise<string | null> => {
    if (fileCache.has(path)) {
      fileCacheHits++
      return fileCache.get(path) ?? null
    }
    fileReads++
    const body = await readFileFn(input.deps.creds, path, ref)
    fileCache.set(path, body)
    return body
  }

  let resolved = 0
  let unresolved = 0
  let skipped = 0
  let complete = true
  let lastProcessedId: string | null = null
  const resolveStarted = Date.now()

  for (const finding of targets) {
    if (Date.now() >= deadlineAt) {
      complete = false
      console.info('[resolve-source] deadline mid-batch', {
        siteId: input.siteId,
        lastProcessedId,
        remaining: targets.length - (resolved + unresolved + skipped),
      })
      break
    }

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
      lastProcessedId = finding.id
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
      readFile: cachedRead,
    })

    await store.updateFindingSourceResolution({
      findingId: finding.id,
      ...patch,
    })

    if (patch.sourcePath && patch.sourceBlobSha) resolved++
    else unresolved++
    lastProcessedId = finding.id
  }

  const timings: ResolveSourcesTimings = {
    treeMs,
    resolveMs: Date.now() - resolveStarted,
    totalMs: Date.now() - startedAt,
    targets: targets.length,
    fileReads,
    fileCacheHits,
  }

  console.info('[resolve-source] site complete', {
    siteId: input.siteId,
    resolved,
    unresolved,
    skipped,
    complete,
    lastProcessedId,
    ...timings,
  })
  return {
    resolved,
    unresolved,
    skipped,
    complete,
    lastProcessedFindingId: lastProcessedId,
    timings,
  }
}

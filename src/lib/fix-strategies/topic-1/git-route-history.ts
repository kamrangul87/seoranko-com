/**
 * Git history evidence for a 404 target: did a route file for this path ever
 * exist and get deleted?
 *
 * Uses `git log --diff-filter=D` over site-model-detected route roots (e.g.
 * `src/app`, `app`, `src/pages`). Injectable runner keeps fixtures offline.
 *
 * Three evidence states (never conflated):
 * - `deleted` — matching page file deletion found in reachable history
 * - `no-deletion-found` — history is available, route roots cover the repo's
 *   routing, and no matching deletion was found
 * - `history-unavailable` — shallow clone, git failure, missing runner, empty
 *   / unconfirmed route-root list, or unreachable path history. Absence of
 *   evidence is NOT proof the route never existed.
 */

import type { RouteRoot } from '@/lib/fix-strategies/site-model'

export type GitHistoryStatus =
  | 'deleted'
  | 'no-deletion-found'
  | 'history-unavailable'

export type GitDeletionEvidence = {
  status: GitHistoryStatus
  /** True only when status is `deleted`. */
  deleted: boolean
  /** Paths reported as deleted that map to the URL, when known. */
  deletedPaths: string[]
  detail: string
}

export type GitRunner = (
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string; code: number }>

export type GitProbeOptions = {
  /**
   * Route directories from the site model (`detectRouteRoots`). Required for a
   * conclusive `no-deletion-found`. When empty / omitted and coverage cannot
   * be confirmed, the probe returns `history-unavailable`.
   */
  routeRoots?: RouteRoot[]
  /**
   * When true (default), an empty routeRoots list means coverage is unconfirmed
   * → `history-unavailable` rather than probing a hard-coded `app/` default.
   */
  requireRouteRoots?: boolean
}

/**
 * Map a URL path to plausible page file paths under the given route roots.
 * App Router: `{root}/{segments}/page.{tsx,ts,jsx,js}`
 * Pages Router: `{root}/{segments}.{tsx,ts,jsx,js}` and `{root}/{segments}/index.*`
 */
export function candidatePageRelPaths(
  urlPath: string,
  routeRoots: RouteRoot[],
): string[] {
  const trimmed = urlPath.replace(/^\/+/, '').replace(/\/+$/, '')
  const segments = trimmed === '' ? [] : trimmed.split('/').filter(Boolean)
  const out: string[] = []
  const pageNames = ['page.tsx', 'page.ts', 'page.jsx', 'page.js']
  const fileNames = ['tsx', 'ts', 'jsx', 'js']

  for (const root of routeRoots) {
    if (root.kind === 'app-router') {
      const dir =
        segments.length === 0
          ? root.relDir
          : `${root.relDir}/${segments.join('/')}`
      for (const name of pageNames) out.push(`${dir}/${name}`)
      continue
    }
    // pages-router
    if (segments.length === 0) {
      for (const ext of fileNames) {
        out.push(`${root.relDir}/index.${ext}`)
      }
      continue
    }
    const base = `${root.relDir}/${segments.join('/')}`
    for (const ext of fileNames) {
      out.push(`${base}.${ext}`)
      out.push(`${base}/index.${ext}`)
    }
  }
  return out
}

/**
 * True when the working tree is a shallow clone (`--depth N`).
 * Shallow history cannot prove a route never existed — deletions older than
 * the shallow tip are invisible to `git log --diff-filter=D`.
 */
export async function isShallowClone(
  repoRoot: string,
  runGit: GitRunner,
): Promise<{ shallow: boolean; detail: string; failed: boolean }> {
  const result = await runGit(
    ['rev-parse', '--is-shallow-repository'],
    repoRoot,
  )
  if (result.code !== 0) {
    return {
      shallow: false,
      failed: true,
      detail: `git rev-parse --is-shallow-repository failed: ${
        result.stderr || result.stdout || result.code
      }`,
    }
  }
  const value = result.stdout.trim().toLowerCase()
  return {
    shallow: value === 'true',
    failed: false,
    detail:
      value === 'true'
        ? 'clone is shallow — deletion history beyond the tip is unreachable'
        : 'clone is not shallow',
  }
}

/**
 * True when at least one commit that touches any candidate page path is
 * reachable. On a full clone an empty result means the files never existed;
 * on a shallow (or otherwise truncated) history an empty result is inconclusive.
 */
export async function isPathHistoryReachable(
  repoRoot: string,
  candidates: string[],
  runGit: GitRunner,
): Promise<{ reachable: boolean; detail: string; failed: boolean }> {
  if (candidates.length === 0) {
    return {
      reachable: false,
      failed: false,
      detail: 'no candidate page paths to probe',
    }
  }
  const result = await runGit(
    ['log', '-1', '--pretty=format:%H', '--', ...candidates],
    repoRoot,
  )
  if (result.code !== 0) {
    return {
      reachable: false,
      failed: true,
      detail: `git log for candidate paths failed: ${
        result.stderr || result.stdout || result.code
      }`,
    }
  }
  const hash = result.stdout.trim()
  if (!hash) {
    return {
      reachable: false,
      failed: false,
      detail: 'no reachable commits touch candidate page paths',
    }
  }
  return {
    reachable: true,
    failed: false,
    detail: `path history reachable (latest ${hash.slice(0, 8)})`,
  }
}

function unavailable(detail: string): GitDeletionEvidence {
  return {
    status: 'history-unavailable',
    deleted: false,
    deletedPaths: [],
    detail,
  }
}

function noDeletionFound(detail: string): GitDeletionEvidence {
  return {
    status: 'no-deletion-found',
    deleted: false,
    deletedPaths: [],
    detail,
  }
}

/**
 * Look for deleted page files that would have served `urlPath`.
 *
 * Positive deletion matches are trusted even on a shallow clone (the deletion
 * commit is present). Negative results on shallow / unreachable history, or
 * when route-root coverage is unconfirmed, are `history-unavailable` — never
 * `no-deletion-found`.
 */
export async function findDeletedRouteEvidence(
  repoRoot: string,
  urlPath: string,
  runGit: GitRunner,
  options: GitProbeOptions = {},
): Promise<GitDeletionEvidence> {
  const requireRouteRoots = options.requireRouteRoots !== false
  const routeRoots = options.routeRoots ?? []

  if (routeRoots.length === 0) {
    return unavailable(
      requireRouteRoots
        ? 'history-unavailable: no site-model route roots detected — cannot confirm git path candidates cover the repo routing'
        : 'history-unavailable: empty routeRoots — refusing default app/** probe; pass site-model roots',
    )
  }

  const candidates = candidatePageRelPaths(urlPath, routeRoots)
  const candidateSet = new Set(candidates)
  const searchDirs = [...new Set(routeRoots.map((r) => r.relDir))]

  const shallow = await isShallowClone(repoRoot, runGit)
  if (shallow.failed) {
    return unavailable(shallow.detail)
  }

  // Run the deletion log before treating path-history emptiness as conclusive —
  // a positive match in the tip is trusted even on a shallow clone.
  const result = await runGit(
    ['log', '--diff-filter=D', '--summary', '--', ...searchDirs],
    repoRoot,
  )

  if (result.code !== 0) {
    return unavailable(
      `git log failed: ${result.stderr || result.stdout || result.code}`,
    )
  }

  const deletedPaths: string[] = []
  for (const line of result.stdout.split('\n')) {
    // e.g. " delete mode 100644 src/app/old/page.tsx"
    const m = line.match(/delete mode \d+ (.+\S)/)
    if (!m) continue
    const rel = m[1]!.replace(/^\.\//, '')
    if (candidateSet.has(rel) || candidateSet.has(rel.replace(/^\/+/, ''))) {
      deletedPaths.push(rel)
    }
  }

  if (deletedPaths.length > 0) {
    return {
      status: 'deleted',
      deleted: true,
      deletedPaths,
      detail: `deleted route file(s): ${deletedPaths.join(', ')}`,
    }
  }

  // No matching deletion in what we can see. Only call that "no deletion"
  // when history is deep enough AND route-root coverage is confirmed.
  if (shallow.shallow) {
    return unavailable(
      'history-unavailable: shallow clone — absence of deletion evidence is not proof the route never existed',
    )
  }

  const pathProbe = await isPathHistoryReachable(
    repoRoot,
    candidates,
    runGit,
  )
  if (pathProbe.failed) {
    return unavailable(pathProbe.detail)
  }

  if (!pathProbe.reachable) {
    return noDeletionFound(
      `no deleted page file matched this URL path under [${searchDirs.join(', ')}] (no reachable history for candidate pages)`,
    )
  }

  return noDeletionFound(
    `no deleted page file matched this URL path under [${searchDirs.join(', ')}]`,
  )
}

/** Factory for the missing-runner / missing-repoRoot case in the detector. */
export function gitEvidenceUnavailable(
  detail = 'git evidence unavailable',
): GitDeletionEvidence {
  return unavailable(detail)
}

/**
 * Git history evidence for a 404 target: did a route file for this path ever
 * exist and get deleted?
 *
 * Uses `git log --diff-filter=D` over the app routes directory. Injectable
 * runner keeps fixtures offline (no real git required in unit tests).
 *
 * Three evidence states (never conflated):
 * - `deleted` — matching page file deletion found in reachable history
 * - `no-deletion-found` — history is available and searchable; no matching deletion
 * - `history-unavailable` — shallow clone, git failure, missing runner, or
 *   unreachable path history. Absence of evidence is NOT proof the route never
 *   existed.
 */

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

/**
 * Map a URL path to plausible App Router page file suffixes under `app/`.
 * Static routes only for deletion evidence — dynamic patterns are not proof
 * a specific resource existed.
 */
export function candidatePageRelPaths(urlPath: string): string[] {
  const trimmed = urlPath.replace(/^\/+/, '').replace(/\/+$/, '')
  const base = trimmed === '' ? '' : trimmed
  const dir = base ? `app/${base}` : 'app'
  const names = ['page.tsx', 'page.ts', 'page.jsx', 'page.js']
  return names.map((n) => `${dir}/${n}`)
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

function unavailable(
  detail: string,
): GitDeletionEvidence {
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
 * commit is present). Negative results on shallow / unreachable history are
 * `history-unavailable`, never `no-deletion-found`.
 */
export async function findDeletedRouteEvidence(
  repoRoot: string,
  urlPath: string,
  runGit: GitRunner,
  routesDir = 'app',
): Promise<GitDeletionEvidence> {
  const candidates = candidatePageRelPaths(urlPath)
  const candidateSet = new Set(candidates)

  const shallow = await isShallowClone(repoRoot, runGit)
  if (shallow.failed) {
    return unavailable(shallow.detail)
  }

  // Run the deletion log before treating path-history emptiness as conclusive —
  // a positive match in the tip is trusted even on a shallow clone.
  const result = await runGit(
    ['log', '--diff-filter=D', '--summary', '--', routesDir],
    repoRoot,
  )

  if (result.code !== 0) {
    return unavailable(
      `git log failed: ${result.stderr || result.stdout || result.code}`,
    )
  }

  const deletedPaths: string[] = []
  for (const line of result.stdout.split('\n')) {
    // e.g. " delete mode 100644 app/old/page.tsx"
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
  // when history is deep enough that absence is meaningful.
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
    // Full clone, but no commit ever touched the candidate page files.
    // Affirmative "never existed as these page files" for static route evidence.
    return noDeletionFound(
      'no deleted page file matched this URL path (no reachable history for candidate pages)',
    )
  }

  return noDeletionFound('no deleted page file matched this URL path')
}

/** Factory for the missing-runner / missing-repoRoot case in the detector. */
export function gitEvidenceUnavailable(
  detail = 'git evidence unavailable',
): GitDeletionEvidence {
  return unavailable(detail)
}

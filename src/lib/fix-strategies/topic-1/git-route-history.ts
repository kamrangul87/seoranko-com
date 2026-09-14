/**
 * Git history evidence for a 404 target: did a route file for this path ever
 * exist and get deleted?
 *
 * Uses `git log --diff-filter=D` over the app routes directory. Injectable
 * runner keeps fixtures offline (no real git required in unit tests).
 */

export type GitDeletionEvidence = {
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
 * Look for deleted page files that would have served `urlPath`.
 */
export async function findDeletedRouteEvidence(
  repoRoot: string,
  urlPath: string,
  runGit: GitRunner,
  routesDir = 'app',
): Promise<GitDeletionEvidence> {
  const candidates = new Set(candidatePageRelPaths(urlPath))
  const result = await runGit(
    ['log', '--diff-filter=D', '--summary', '--', routesDir],
    repoRoot,
  )

  if (result.code !== 0) {
    return {
      deleted: false,
      deletedPaths: [],
      detail: `git log failed: ${result.stderr || result.stdout || result.code}`,
    }
  }

  const deletedPaths: string[] = []
  for (const line of result.stdout.split('\n')) {
    // e.g. " delete mode 100644 app/old/page.tsx"
    const m = line.match(/delete mode \d+ (.+\S)/)
    if (!m) continue
    const rel = m[1]!.replace(/^\.\//, '')
    if (candidates.has(rel) || candidates.has(rel.replace(/^\/+/, ''))) {
      deletedPaths.push(rel)
    }
  }

  if (deletedPaths.length === 0) {
    return {
      deleted: false,
      deletedPaths: [],
      detail: 'no deleted page file matched this URL path',
    }
  }

  return {
    deleted: true,
    deletedPaths,
    detail: `deleted route file(s): ${deletedPaths.join(', ')}`,
  }
}

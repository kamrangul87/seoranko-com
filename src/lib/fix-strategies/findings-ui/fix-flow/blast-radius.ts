/**
 * Single-file blast-radius gate for findings auto-merge.
 *
 * Site-wide config and shared layouts always stay human-review, even when
 * auto_merge_enabled is ON.
 */

/** Paths that must never be auto-merged (site-wide / shared). */
const BLOCKED_PATH_PATTERNS: RegExp[] = [
  /(^|\/)vercel\.json$/i,
  /(^|\/)next\.config\.[cm]?[jt]s$/i,
  /(^|\/)nuxt\.config\.[cm]?[jt]s$/i,
  /(^|\/)astro\.config\.[cm]?[jt]s$/i,
  /(^|\/)robots\.txt$/i,
  /(^|\/)sitemap([.-].*)?\.(xml|ts|js|mjs)$/i,
  /(^|\/)app\/sitemap\.[jt]sx?$/i,
  /(^|\/)pages\/sitemap\.[jt]sx?$/i,
  /(^|\/)middleware\.[jt]sx?$/i,
  /(^|\/)app\/layout\.[jt]sx?$/i,
  /(^|\/)app\/.*\/layout\.[jt]sx?$/i,
  /(^|\/)layouts\//i,
  /(^|\/)_app\.[jt]sx?$/i,
  /(^|\/)_document\.[jt]sx?$/i,
  /(^|\/)components\/.*(Layout|Shell|Nav|Header|Footer)/i,
]

export type BlastRadiusResult =
  | { ok: true; path: string }
  | { ok: false; reason: string }

/**
 * Auto-merge requires exactly one changed file, and that file must not be
 * site-wide config or a shared layout.
 */
export function assessSingleFileBlastRadius(
  changedPaths: string[],
): BlastRadiusResult {
  const paths = changedPaths
    .map((p) => p.replace(/^\.\//, '').trim())
    .filter(Boolean)

  if (paths.length === 0) {
    return { ok: false, reason: 'PR changes no files — cannot auto-merge' }
  }
  if (paths.length > 1) {
    return {
      ok: false,
      reason: `PR touches ${paths.length} files — auto-merge requires single-file blast radius`,
    }
  }

  const path = paths[0]!
  for (const re of BLOCKED_PATH_PATTERNS) {
    if (re.test(path)) {
      return {
        ok: false,
        reason: `Path ${path} is site-wide config or shared layout — human-review only`,
      }
    }
  }

  return { ok: true, path }
}

/** True when a proposed commit path alone would be blocked. */
export function isBlockedAutoMergePath(path: string): boolean {
  return !assessSingleFileBlastRadius([path]).ok
}

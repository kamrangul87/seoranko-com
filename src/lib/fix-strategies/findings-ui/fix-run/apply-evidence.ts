/**
 * Path helpers shared by the Fix Agent registry.
 * Topic-49 resolvePath uses pathFromPageUrl; other topics are not registered
 * until their detectors emit an exact repo file target (Phase 2 pre-check).
 */

/** Static HTML path under public/ from a page URL (topic 49 / fixture). */
export function pathFromPageUrl(pageUrl: string | null): string | null {
  if (!pageUrl) return null
  try {
    const u = new URL(pageUrl)
    let path = u.pathname.replace(/^\//, '')
    if (!path || path.endsWith('/')) path = `${path}index.html`.replace(/^\//, '')
    if (!/\.(html?|md|mdx)$/i.test(path)) {
      if (!path.includes('.')) path = `${path}.html`
    }
    if (/\.(jsx|tsx|js|ts|mjs|cjs)$/i.test(path)) return null
    if (!path.startsWith('public/')) return `public/${path}`
    return path
  } catch {
    return null
  }
}

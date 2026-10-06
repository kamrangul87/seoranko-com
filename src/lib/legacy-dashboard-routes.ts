/**
 * Legacy content / keyword / ranking dashboard surfaces.
 * Kept in the tree but unreachable — temporary 307 → /dashboard.
 * Do not delete page files in the dashboard-focus pass.
 */
export const LEGACY_DASHBOARD_ROUTES = [
  '/dashboard/write',
  '/dashboard/keywords',
  '/dashboard/rankings',
  '/dashboard/briefs',
  '/dashboard/ai-visibility',
  '/dashboard/sitemap',
  '/dashboard/content',
  '/dashboard/content-roi',
  '/dashboard/images',
  '/dashboard/improve',
  '/dashboard/topical-map',
  '/dashboard/nlp',
  '/dashboard/optimise',
  '/dashboard/research',
  '/dashboard/discovery',
  '/dashboard/intelligence',
  '/dashboard/performance',
  '/dashboard/ranking-agent',
  '/dashboard/site-audit',
  '/dashboard/site-audit/repair-order',
  '/dashboard/extension',
  // Old hub aliases that previously chained into the routes above
  '/dashboard/articles',
  '/dashboard/humanize',
  '/dashboard/improve-article',
  '/dashboard/nlp-analyser',
  '/dashboard/roi',
] as const

export type LegacyDashboardRoute = (typeof LEGACY_DASHBOARD_ROUTES)[number]

/** True when pathname is a legacy dashboard route (exact or nested under one). */
export function isLegacyDashboardPath(pathname: string): boolean {
  const path = pathname.replace(/\/$/, '') || '/'
  return LEGACY_DASHBOARD_ROUTES.some((route) => {
    if (path === route) return true
    // Nested legacy screens (e.g. /dashboard/keywords/serp-intent)
    if (path.startsWith(`${route}/`)) return true
    return false
  })
}

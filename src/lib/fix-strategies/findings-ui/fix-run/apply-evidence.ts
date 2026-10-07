/**
 * Read deterministic apply parameters persisted on a finding.
 * Detectors emit these fields; ingestArray copies them into evidenceValues.
 */

import type { PersistedFindingRow } from '../crawl/constants'

function ev(finding: PersistedFindingRow): Record<string, unknown> {
  return (finding.evidenceValues ?? {}) as Record<string, unknown>
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Topic 1 — dead anchor href to remove. */
export function evidenceHref(finding: PersistedFindingRow): string | null {
  return str(ev(finding).href) ?? str(ev(finding).targetHref)
}

/** Topic 42 — old href + rewrite destination. */
export function evidenceRewrite(finding: PersistedFindingRow): {
  fromHref: string
  toHref: string
} | null {
  const fromHref = str(ev(finding).href)
  const toHref = str(ev(finding).rewriteHref)
  if (!fromHref || !toHref) return null
  return { fromHref, toHref }
}

/** Topic 26 — loc to remove or replace. */
export function evidenceSitemapLoc(finding: PersistedFindingRow): {
  loc: string
  replaceWith: string | null
} | null {
  const loc = str(ev(finding).loc) ?? finding.pageUrl
  if (!loc) return null
  return { loc, replaceWith: str(ev(finding).replaceWith) }
}

/** Topic 13 — preferred absolute canonical URL. */
export function evidencePreferredCanonical(
  finding: PersistedFindingRow,
): string | null {
  return str(ev(finding).preferredForm) ?? finding.pageUrl
}

/** Topic 14 — self-canonical absolute URL. */
export function evidenceSelfCanonical(
  finding: PersistedFindingRow,
): string | null {
  return str(ev(finding).selfCanonical) ?? finding.pageUrl
}

/** Topic 17 — collapse target href (redundant) when known. */
export function evidenceCollapseTo(
  finding: PersistedFindingRow,
): string | null {
  return str(ev(finding).collapseTo) ?? finding.pageUrl
}

/** Static HTML path under public/ from a page URL. */
export function pathFromPageUrl(pageUrl: string | null): string | null {
  if (!pageUrl) return null
  try {
    const u = new URL(pageUrl)
    let path = u.pathname.replace(/^\//, '')
    if (!path || path.endsWith('/')) path = `${path}index.html`.replace(/^\//, '')
    if (!/\.(html?|md|mdx)$/i.test(path)) {
      if (!path.includes('.')) path = `${path}.html`
    }
    // Never resolve JSX/TSX from a URL — unsupported for these transforms.
    if (/\.(jsx|tsx|js|ts|mjs|cjs)$/i.test(path)) return null
    if (!path.startsWith('public/')) return `public/${path}`
    return path
  } catch {
    return null
  }
}

export function isStaticHtmlPath(path: string | null): boolean {
  return !!path && /\.html?$/i.test(path)
}

/**
 * Read deterministic apply parameters persisted on a finding.
 * Detectors emit these fields; ingestArray copies them into evidenceValues.
 * Source-file resolution uses evidenceNeedleForResolution — never invents paths.
 */

import type { PersistedFindingRow } from '../crawl/constants'
import type { SourceEvidence } from './resolve-source-file'

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

/** Topic 14 — self-canonical absolute URL (write target). */
export function evidenceSelfCanonical(
  finding: PersistedFindingRow,
): string | null {
  return str(ev(finding).selfCanonical) ?? finding.pageUrl
}

/** Topic 14 — broken canonical href currently in the file (resolution needle). */
export function evidenceBrokenCanonical(
  finding: PersistedFindingRow,
): string | null {
  return str(ev(finding).canonicalUrl)
}

/** Topic 17 — collapse target href when known. */
export function evidenceCollapseTo(
  finding: PersistedFindingRow,
): string | null {
  return str(ev(finding).collapseTo) ?? finding.pageUrl
}

/** Topic 22 — first crawl-delay raw line for resolution + removal confirmation. */
export function evidenceCrawlDelayRaw(
  finding: PersistedFindingRow,
): string | null {
  const lines = ev(finding).crawlDelayLines
  if (Array.isArray(lines)) {
    for (const line of lines) {
      if (typeof line === 'string' && line.length > 0) return line
      if (line && typeof line === 'object') {
        const raw = (line as { raw?: unknown }).raw
        if (typeof raw === 'string' && raw.length > 0) return raw
      }
    }
  }
  return str(ev(finding).crawlDelayRaw)
}

/** Topic 49 — img src attribute used as resolution needle. */
export function evidenceSrcAttr(finding: PersistedFindingRow): string | null {
  return str(ev(finding).srcAttr)
}

/**
 * Exact evidence string + expected count for resolveSourceFile.
 * Returns null when the finding has nothing locatable in a static file
 * (e.g. topic 13 add-canonical when preferredForm is not yet in the file).
 */
export function evidenceNeedleForResolution(
  finding: PersistedFindingRow,
): SourceEvidence | null {
  const expectedFromEv = ev(finding).evidenceExpectedCount
  const expectedCount =
    typeof expectedFromEv === 'number' &&
    Number.isFinite(expectedFromEv) &&
    expectedFromEv >= 1
      ? Math.floor(expectedFromEv)
      : 1

  switch (finding.topicId) {
    case '1': {
      const href = evidenceHref(finding)
      return href ? { needle: href, expectedCount } : null
    }
    case '14': {
      // Locate via the broken canonical currently in the file, not the write target.
      const broken = evidenceBrokenCanonical(finding)
      return broken ? { needle: broken, expectedCount } : null
    }
    case '17': {
      const collapse = str(ev(finding).collapseTo)
      if (collapse) return { needle: collapse, expectedCount }
      const bodyHref = str(ev(finding).bodyCanonicalHref)
      return bodyHref ? { needle: bodyHref, expectedCount } : null
    }
    case '22': {
      const raw = evidenceCrawlDelayRaw(finding)
      return raw ? { needle: raw, expectedCount } : null
    }
    case '26': {
      const loc = evidenceSitemapLoc(finding)?.loc
      return loc ? { needle: loc, expectedCount } : null
    }
    case '42': {
      const href = evidenceHref(finding)
      return href ? { needle: href, expectedCount } : null
    }
    case '49': {
      const src = evidenceSrcAttr(finding)
      return src ? { needle: src, expectedCount } : null
    }
    case 'fixture': {
      // Fixture pages are identified by a stable marker or page body snippet.
      const marker = str(ev(finding).resolveNeedle) ?? '<body'
      return { needle: marker, expectedCount }
    }
    case '13':
      // preferredForm is what we ADD — typically absent from the file today.
      return null
    default:
      return null
  }
}

/**
 * URL to resolve against the repo tree for this finding.
 * Sitemap / robots findings use the artefact URL; others use pageUrl.
 */
export function resolutionUrlForFinding(
  finding: PersistedFindingRow,
): string | null {
  if (finding.topicId === '26') {
    // Loc is the sitemap entry URL; the file to edit is /sitemap.xml.
    try {
      const base = finding.pageUrl || evidenceSitemapLoc(finding)?.loc
      if (!base) return null
      return `${new URL(base).origin}/sitemap.xml`
    } catch {
      return null
    }
  }
  if (finding.topicId === '22') {
    return finding.pageUrl
  }
  return finding.pageUrl
}

/** @deprecated Prefer stored sourcePath from resolveSourceFile. Kept for tests. */
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

export function isStaticHtmlPath(path: string | null): boolean {
  return !!path && /\.html?$/i.test(path)
}

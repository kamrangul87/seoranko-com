/**
 * Canonical URL equivalence — shared rules for every site SEORANKO audits.
 *
 * Directory → index.html consolidation is valid (/blog canonicalizing to
 * /blog/index.html). The reverse (index.html canonicalizing to /blog/) is a
 * misconfiguration on static sites and is flagged for follow-up.
 */

import { normalizeUrl } from '@/lib/supabase/audit-db'

const INDEX_HTML_RE = /\/index\.html?$/i

/** Expand a URL into comparable variants (directory ↔ index.html on same path). */
export function expandCanonicalUrlVariants(url: string): Set<string> {
  const variants = new Set<string>()
  try {
    const normalized = normalizeUrl(url)
    variants.add(normalized)

    const u = new URL(normalized)
    const path = u.pathname

    if (INDEX_HTML_RE.test(path)) {
      const dirPath = path.replace(INDEX_HTML_RE, '') || '/'
      variants.add(normalizeUrl(`${u.origin}${dirPath}`))
    } else if (path && path !== '/') {
      const lastSeg = path.split('/').filter(Boolean).pop() || ''
      const looksLikeFile = /\.[a-z0-9]+$/i.test(lastSeg)
      if (!looksLikeFile) {
        variants.add(normalizeUrl(`${u.origin}${path}/index.html`))
        variants.add(normalizeUrl(`${u.origin}${path}/index.htm`))
      }
    }
  } catch {
    variants.add(url.trim())
  }
  return variants
}

export function isIndexHtmlUrl(url: string): boolean {
  return INDEX_HTML_RE.test(url)
}

/** True when page URL and canonical href refer to the same page (symmetric variant match). */
export function canonicalUrlsEquivalent(pageUrl: string, canonicalUrl: string): boolean {
  if (!canonicalUrl.trim()) return false
  const pageVariants = expandCanonicalUrlVariants(pageUrl)
  const canonVariants = expandCanonicalUrlVariants(canonicalUrl)
  for (const v of pageVariants) {
    if (canonVariants.has(v)) return true
  }
  return false
}

/**
 * Whether the canonical tag is acceptable for this page URL.
 * Rejects index.html → directory consolidation; accepts directory → index.html.
 */
export function canonicalConsolidationOk(pageUrl: string, canonicalUrl: string): boolean {
  if (!canonicalUrlsEquivalent(pageUrl, canonicalUrl)) return false

  // index.html must not canonicalize to its parent directory URL
  if (isIndexHtmlUrl(pageUrl) && !isIndexHtmlUrl(canonicalUrl)) {
    return false
  }
  return true
}

export interface CanonicalMismatchEvidence {
  pageUrl: string
  canonicalUrl: string
}

const MISMATCH_EVIDENCE_RE =
  /^Canonical points to different same-host URL: ([^\s]+) \(page ([^)]+)\)$/

/** Parse the canonical mismatch evidence string produced by classifyCanonical. */
export function parseCanonicalMismatchEvidence(evidence: string): CanonicalMismatchEvidence | null {
  const m = evidence.match(MISMATCH_EVIDENCE_RE)
  if (!m) return null
  return { canonicalUrl: m[1]!, pageUrl: m[2]! }
}

/** Whether this page should surface as an index.html canonical misconfiguration follow-up. */
export function isIndexHtmlCanonicalMisconfiguration(
  pageUrl: string,
  canonicalUrl: string,
): boolean {
  if (!isIndexHtmlUrl(pageUrl)) return false
  if (!canonicalUrl) return false
  return !canonicalConsolidationOk(pageUrl, canonicalUrl)
}

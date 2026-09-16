export type ExtractedAnchor = {
  href: string
  /** Raw attribute value as it appeared in HTML. */
  raw: string
}

/**
 * Matches:
 * - double-quoted:  href="..."
 * - single-quoted:  href='...'
 * - curly-quoted:   href=“...” / href=”...” / href=‘...’ / href=’...’
 *   (CMS often uses U+201D on both sides)
 * - unquoted:       href=/path or href=https://...
 */
const HREF_RE =
  /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|[\u201C\u201D]([^\u201C\u201D]*)[\u201C\u201D]|[\u2018\u2019]([^\u2018\u2019]*)[\u2018\u2019]|([^\s>]+))/gi

function normalizeHrefValue(raw: string): string {
  return raw
    .trim()
    .replace(/^[\u201C\u201D\u2018\u2019]+/, '')
    .replace(/[\u201C\u201D\u2018\u2019]+$/, '')
}

/**
 * Scheme / fragment filter from topic 1 guards. Applied before any fetch.
 */
export function isSkippableHref(href: string): boolean {
  const trimmed = href.trim()
  if (!trimmed) return true
  if (trimmed === '#') return true
  if (trimmed.startsWith('#')) return true
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('mailto:')) return true
  if (lower.startsWith('tel:')) return true
  if (lower.startsWith('javascript:')) return true
  if (lower.startsWith('data:')) return true
  return false
}

/**
 * Resolve href against a page URL and decide whether it is same-origin.
 */
export function isInternalHref(href: string, pageUrl: string): boolean {
  if (isSkippableHref(href)) return false
  try {
    const base = new URL(pageUrl)
    const resolved = new URL(href, base)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return false
    }
    return resolved.host === base.host
  } catch {
    return false
  }
}

/**
 * Extract `<a href>` values from HTML. Does not fetch.
 * Supports quoted, unquoted, and curly-quoted attribute values.
 */
export function extractAnchors(html: string): ExtractedAnchor[] {
  const out: ExtractedAnchor[] = []
  const matches = Array.from(html.matchAll(HREF_RE))
  for (const match of matches) {
    const raw = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''
    out.push({ href: normalizeHrefValue(raw), raw })
  }
  return out
}

/**
 * Internal, fetchable anchors from a page.
 */
export function extractInternalFetchableAnchors(
  html: string,
  pageUrl: string,
): ExtractedAnchor[] {
  return extractAnchors(html).filter(
    (a) => !isSkippableHref(a.href) && isInternalHref(a.href, pageUrl),
  )
}

/**
 * Normalize a URL for fix-strategy comparisons.
 *
 * MUST:
 * - resolve relative URLs against `base` when provided
 * - lowercase scheme and host
 * - resolve `.` / `..` path segments
 *
 * MUST NOT:
 * - collapse trailing slash (`/page` vs `/page/` stay distinct)
 * - change path case (`/Page` vs `/page` stay distinct)
 * - drop or rewrite the query string
 * - drop or rewrite a non-default port (keep `:8080`)
 *
 * MAY strip the fragment. Default ports 80/443 may be omitted (URL() behaviour).
 *
 * Returns `null` when the input cannot be parsed as a URL.
 */
export function normalizeFixStrategyUrl(
  raw: string,
  base?: string,
): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let parsed: URL
  try {
    parsed = base !== undefined ? new URL(trimmed, base) : new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null
  }

  parsed.hash = ''
  parsed.hostname = parsed.hostname.toLowerCase()
  parsed.protocol = parsed.protocol.toLowerCase() as `${string}:`

  // Omit default ports the way URL() does; keep non-default ports.
  if (
    (parsed.protocol === 'https:' &&
      (parsed.port === '443' || parsed.port === '')) ||
    (parsed.protocol === 'http:' && (parsed.port === '80' || parsed.port === ''))
  ) {
    parsed.port = ''
  }

  const path = parsed.pathname || '/'
  const search = parsed.search || ''
  const host = parsed.host // hostname + non-default port
  return `${parsed.protocol}//${host}${path}${search}`
}

/**
 * Build a rewrite destination that PRESERVES query parameters and fragments
 * from the original href (topic 42 condition 5).
 *
 * Fragments are never sent on the wire, so redirects always drop them — they
 * must be restored from `sourceHref`. Query params present on the source but
 * absent from the redirect target are merged in (destination wins on key
 * conflict).
 *
 * Returns a same-origin path form (`/new?utm=x#section`) when `base` is the
 * page origin and dest is same-host; otherwise an absolute URL. `null` if
 * either side is unparseable.
 */
export function preserveQueryAndFragment(
  sourceHref: string,
  destinationUrl: string,
  base?: string,
): string | null {
  let source: URL
  let dest: URL
  try {
    source = base !== undefined ? new URL(sourceHref, base) : new URL(sourceHref)
    dest =
      base !== undefined ? new URL(destinationUrl, base) : new URL(destinationUrl)
  } catch {
    return null
  }

  if (dest.protocol !== 'http:' && dest.protocol !== 'https:') return null

  // Merge query: keep dest keys; add source keys that dest lacks.
  if (source.search) {
    const destParams = new URLSearchParams(dest.search)
    const sourceParams = new URLSearchParams(source.search)
    for (const [key, value] of sourceParams.entries()) {
      if (!destParams.has(key)) destParams.append(key, value)
    }
    const qs = destParams.toString()
    dest.search = qs ? `?${qs}` : ''
  }

  // Always restore fragment from the original href.
  if (source.hash) {
    dest.hash = source.hash
  }

  // Prefer path-absolute same-origin form for HTML href rewrites.
  if (base) {
    try {
      const origin = new URL(base)
      if (dest.host === origin.host && dest.protocol === origin.protocol) {
        return `${dest.pathname}${dest.search}${dest.hash}`
      }
    } catch {
      // fall through to absolute
    }
  }

  return dest.href
}

/**
 * True when rewriting `sourceHref` → `proposedHref` would drop query or
 * fragment that `preserveQueryAndFragment` is required to keep.
 */
export function wouldDropQueryOrFragment(
  sourceHref: string,
  proposedHref: string,
  base?: string,
): boolean {
  let source: URL
  let proposed: URL
  try {
    source = base !== undefined ? new URL(sourceHref, base) : new URL(sourceHref)
    proposed =
      base !== undefined ? new URL(proposedHref, base) : new URL(proposedHref)
  } catch {
    return true
  }

  if (source.hash && source.hash !== proposed.hash) return true

  if (source.search) {
    const sourceParams = new URLSearchParams(source.search)
    const proposedParams = new URLSearchParams(proposed.search)
    for (const key of sourceParams.keys()) {
      if (!proposedParams.has(key)) return true
    }
  }

  return false
}

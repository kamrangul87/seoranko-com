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

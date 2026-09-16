/**
 * Normalize a canonical URL for GSC row matching (topics 55, 58, 59).
 *
 * GSC rows are already canonical URLs. This helper makes scheme/host
 * comparisons stable without inventing equivalence GSC does not assert:
 *
 * - lowercase scheme + host
 * - strip fragment
 * - resolve `.` / `..` path segments
 *
 * MUST NOT collapse trailing slash or change path case (same constraints as
 * `normalizeFixStrategyUrl`). Query and non-default ports are preserved.
 */
export function normalizeCanonicalForGscMatch(url: string): string {
  const trimmed = url.trim()
  try {
    const parsed = new URL(trimmed)
    parsed.hash = ''
    parsed.hostname = parsed.hostname.toLowerCase()
    parsed.protocol = parsed.protocol.toLowerCase() as `${string}:`

    if (
      (parsed.protocol === 'https:' &&
        (parsed.port === '443' || parsed.port === '')) ||
      (parsed.protocol === 'http:' &&
        (parsed.port === '80' || parsed.port === ''))
    ) {
      parsed.port = ''
    }

    const path = parsed.pathname || '/'
    const search = parsed.search || ''
    return `${parsed.protocol}//${parsed.host}${path}${search}`
  } catch {
    // Best-effort: strip fragment without inventing structure.
    const hash = trimmed.indexOf('#')
    return hash >= 0 ? trimmed.slice(0, hash) : trimmed
  }
}

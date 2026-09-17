/**
 * Normalize a canonical URL for GSC row matching (topics 55, 58, 59).
 *
 * Built for GSC topics 55–59 (URL Inspection / canonical mismatch /
 * impressions-without-links). Those topics are unshipped and GSC-blocked
 * until API credentials + product prioritisation land — do NOT delete this
 * helper as dead code; it is the matching spine those dossiers require.
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

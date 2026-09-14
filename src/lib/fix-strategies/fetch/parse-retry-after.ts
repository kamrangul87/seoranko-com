/**
 * Parse Retry-After (RFC 9110 §10.2.3): delta-seconds or HTTP-date.
 * Malformed → null (treated as absent, never as zero).
 */
export function parseRetryAfter(
  value: string | null,
  nowMs: number = Date.now(),
): number | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed)
    if (!Number.isFinite(seconds) || seconds < 0) return null
    return seconds * 1000
  }

  const dateMs = Date.parse(trimmed)
  if (Number.isNaN(dateMs)) return null
  const delta = dateMs - nowMs
  if (delta < 0) return 0
  return delta
}

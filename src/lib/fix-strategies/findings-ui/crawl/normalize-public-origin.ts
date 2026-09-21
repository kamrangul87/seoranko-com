/**
 * Normalize a public URL or host into an https origin for detection-only crawl.
 * No DNS lookup, no credentials — parse only.
 */
export function normalizePublicOrigin(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let parsed: URL
  try {
    parsed = trimmed.includes('://')
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname || parsed.hostname === 'localhost') return null
  // Block obvious private / link-local hosts (no resolve — string check only)
  const host = parsed.hostname.toLowerCase()
  if (
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return null
  }

  parsed.protocol = 'https:'
  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''
  parsed.username = ''
  parsed.password = ''
  // Strip default www for origin identity (same as connected-site path)
  const bare = parsed.hostname.replace(/^www\./i, '')
  return `https://${bare}`
}

// Shared live-page fetcher. Extracted from competitor-gap.ts so the RANKO
// fix flow and the gap analyser use one implementation.

/**
 * Fetch a live URL and strip it down to readable text.
 * Returns '' on any failure — callers decide how to surface that.
 */
export async function fetchPageContent(url: string, maxChars = 8000): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SEORANKO-Content-Fetcher/1.0' },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return ''
    const html = await res.text()
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxChars)
  } catch {
    return ''
  }
}

/**
 * Guard for fetching user-supplied URLs server-side. Blocks non-HTTP schemes
 * and hosts that resolve to the local network, so this endpoint can't be used
 * to probe internal services.
 */
export function isSafePublicUrl(raw: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

  const host = parsed.hostname.toLowerCase()

  if (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) return false

  // IPv4 private / loopback / link-local / metadata ranges
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 10 || a === 127 || a === 0) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 169 && b === 254) return false   // includes cloud metadata 169.254.169.254
  }

  return true
}

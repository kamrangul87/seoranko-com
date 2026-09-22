// Shared live-page fetcher. Extracted from competitor-gap.ts so the RANKO
// fix flow and the gap analyser use one implementation.
//
// Keep this module free of node: builtins — it is imported from paths that
// can reach the client bundle (e.g. article-resolver → dashboard pages).
// DNS-resolved SSRF checks live in assert-safe-public-url-resolved.ts
// (server-only).

/**
 * Fetch a live URL and strip it down to readable text.
 * Returns '' on any failure — callers decide how to surface that.
 */
export async function fetchPageContent(url: string, maxChars = 8000): Promise<string> {
  try {
    if (!isSafePublicUrl(url)) return ''
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SEORANKOBot/1.0 (+https://seoranko.com/bot)' },
      signal: AbortSignal.timeout(15000),
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
 * Same fetch, but also pulls the <title> out before the tags are stripped.
 */
export async function fetchPageWithTitle(
  url: string,
  maxChars = 8000
): Promise<{ content: string; title: string }> {
  try {
    if (!isSafePublicUrl(url)) return { content: '', title: '' }
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SEORANKOBot/1.0 (+https://seoranko.com/bot)' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { content: '', title: '' }
    const html = await res.text()
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const content = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxChars)
    return { content, title: titleMatch ? titleMatch[1].trim() : '' }
  } catch {
    return { content: '', title: '' }
  }
}

/**
 * True when an IPv4/IPv6 address string is safe to fetch (not private / metadata).
 * Used after DNS resolution — never trust the hostname string alone.
 */
export function isSafePublicIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized.includes(':')) {
    return isSafePublicUrl(`http://[${normalized}]/`)
  }
  return isSafePublicUrl(`http://${normalized}/`)
}

/**
 * Guard for fetching user-supplied URLs server-side. Blocks non-HTTP schemes
 * and literal hosts in private / cloud-metadata ranges.
 *
 * This is the string/literal gate only. Server fetch paths that open sockets
 * MUST also use {@link assertSafePublicUrlResolved} (server-only module) so a
 * public hostname that resolves to a private IP is refused. Callers that
 * follow redirects MUST re-check every hop the same way.
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
    host.endsWith('.local') ||
    // Cloud metadata / IMDS hostnames (string form; IPs covered below)
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host.endsWith('.metadata.google.internal')
  ) {
    return false
  }

  // IPv6: loopback, link-local (fe80::/10), ULA (fc00::/7), unique local
  if (host.includes(':')) {
    const h = host.replace(/^\[|\]$/g, '')
    if (h === '::1' || h === '0:0:0:0:0:0:0:1') return false
    if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
      return false
    }
    if (h.startsWith('fc') || h.startsWith('fd')) return false
  }

  // IPv4 private / loopback / link-local / metadata ranges
  // 169.254.0.0/16 includes AWS/GCP/Azure metadata 169.254.169.254
  // 0.0.0.0/8 — "this" network (blocked)
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 10 || a === 127 || a === 0) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 169 && b === 254) return false
    if (a === 100 && b >= 64 && b <= 127) return false // CGNAT / some cloud
  }

  return true
}

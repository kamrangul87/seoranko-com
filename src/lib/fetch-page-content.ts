// Shared live-page fetcher. Extracted from competitor-gap.ts so the RANKO
// fix flow and the gap analyser use one implementation.

import dns from 'node:dns/promises'
import net from 'node:net'

/**
 * Fetch a live URL and strip it down to readable text.
 * Returns '' on any failure — callers decide how to surface that.
 */
export async function fetchPageContent(
  url: string,
  maxChars = 8000,
  _redirectDepth = 0,
): Promise<string> {
  try {
    if (_redirectDepth > 8) return ''
    if (!(await assertSafePublicUrlResolved(url))) return ''
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SEORANKOBot/1.0 (+https://seoranko.com/bot)' },
      signal: AbortSignal.timeout(15000),
      redirect: 'manual',
    })
    // Manual redirect: re-check every hop (SSRF)
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return ''
      const next = new URL(loc, url).toString()
      return fetchPageContent(next, maxChars, _redirectDepth + 1)
    }
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
  maxChars = 8000,
  _redirectDepth = 0,
): Promise<{ content: string; title: string }> {
  try {
    if (_redirectDepth > 8) return { content: '', title: '' }
    if (!(await assertSafePublicUrlResolved(url))) return { content: '', title: '' }
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SEORANKOBot/1.0 (+https://seoranko.com/bot)' },
      signal: AbortSignal.timeout(15000),
      redirect: 'manual',
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return { content: '', title: '' }
      const next = new URL(loc, url).toString()
      return fetchPageWithTitle(next, maxChars, _redirectDepth + 1)
    }
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
 * True when an IPv4/IPv6 address is safe to fetch (not private / metadata).
 * Used after DNS resolution — never trust the hostname string alone.
 */
export function isSafePublicIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (net.isIPv4(normalized)) {
    return isSafePublicUrl(`http://${normalized}/`)
  }
  if (net.isIPv6(normalized)) {
    return isSafePublicUrl(`http://[${normalized}]/`)
  }
  return false
}

/**
 * Guard for fetching user-supplied URLs server-side. Blocks non-HTTP schemes
 * and literal hosts in private / cloud-metadata ranges.
 *
 * This is the string/literal gate only. Callers that open sockets MUST also
 * use {@link assertSafePublicUrlResolved} so a public hostname that resolves
 * to a private IP is refused. Callers that follow redirects MUST re-check
 * every hop the same way.
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

/**
 * String gate + DNS resolution. A public hostname that resolves to any
 * private / link-local / metadata address is refused. Fail closed on DNS error.
 */
export async function assertSafePublicUrlResolved(raw: string): Promise<boolean> {
  if (!isSafePublicUrl(raw)) return false

  let host: string
  try {
    host = new URL(raw).hostname
  } catch {
    return false
  }

  // Literal IP already validated by isSafePublicUrl
  if (net.isIP(host)) return true

  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true })
    if (addrs.length === 0) return false
    for (const a of addrs) {
      if (!isSafePublicIp(a.address)) return false
    }
    return true
  } catch {
    return false
  }
}

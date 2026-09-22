/**
 * DNS-resolved public-URL gate. Server-only — do not import from client modules.
 *
 * Master launch 1.3: resolve the hostname and check the resolved IP, not the
 * hostname string. A public domain resolving to a private address must be refused.
 */

import 'server-only'
import dns from 'node:dns/promises'
import { isSafePublicIp, isSafePublicUrl } from '@/lib/fetch-page-content'

function isLiteralIp(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true
  if (host.includes(':')) return true
  return false
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
  if (isLiteralIp(host)) return true

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

/**
 * Derive a bare hostname from a Search Console property URL.
 * Supports sc-domain:example.com and https://www.example.com/URL-prefix properties.
 * Never hardcodes a brand or market.
 */

import { normaliseDomain } from '@/lib/connected-sites'

export function domainFromGscPropertyUrl(propertyUrl: string): string | null {
  const raw = (propertyUrl || '').trim()
  if (!raw) return null

  if (/^sc-domain:/i.test(raw)) {
    const host = normaliseDomain(raw.replace(/^sc-domain:/i, ''))
    return host || null
  }

  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const host = normaliseDomain(new URL(withScheme).hostname)
    return host || null
  } catch {
    const host = normaliseDomain(raw)
    return host || null
  }
}

/**
 * Soft brand label from a hostname for auto-created connected_sites rows.
 * Uses the registrable label (example.com → example; app.example.com → example).
 * Not a market/locale default — derived only from the property host.
 */
export function brandHintFromDomain(domain: string): string {
  const parts = normaliseDomain(domain).split('.').filter(Boolean)
  if (parts.length >= 2) return parts[parts.length - 2]!
  return parts[0] || domain
}

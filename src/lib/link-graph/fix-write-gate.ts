/**
 * Decide whether Fix Agent / manual paste can write for a finding URL.
 * Exact-host only — a parent site connection never authorises a subdomain write.
 */

import { hostOf } from '@/lib/site-connection-lookup'
import { normaliseDomain } from '@/lib/connected-sites'

export function requiredFixHost(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null
  return hostOf(sourceUrl)
}

/**
 * Returns null when the connected CMS site may write this source URL.
 * Otherwise returns the host that must be connected in Settings.
 */
export function fixRequiresConnectingHost(opts: {
  sourceUrl: string | null | undefined
  /** Exact connected_sites.domain for the active CMS connection, if any. */
  connectedDomain?: string | null
  cmsConnected?: boolean
}): string | null {
  const need = requiredFixHost(opts.sourceUrl)
  if (!need) return null
  if (!opts.cmsConnected) return need
  const connected = normaliseDomain(opts.connectedDomain || '')
  if (!connected) return need
  if (connected !== need) return need
  return null
}

export function fixRequiresConnectingMessage(host: string): string {
  return `This fix requires connecting ${host} — go to Settings to connect it.`
}

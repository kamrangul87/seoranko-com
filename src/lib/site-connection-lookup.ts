/**
 * Resolve whether an audited URL belongs to a user-owned, actively connected site.
 * Auditing any URL and having write access are separate permission states.
 */

import { normaliseDomain } from './connected-sites'
import { loadConnectionCredentials } from './site-connection-crypto'
import { normaliseSiteUrl } from './wordpress-connector'
import { describeFixableScope, isServerCmsConnection } from './fix-agent-classification'

export interface OwnedSiteConnection {
  siteId: string
  connectionId: string
  domain: string
  brand: string
  cmsType: string
  siteUrl: string
  credentials: Record<string, string>
  lastVerifiedAt: string | null
}

function hostOf(urlOrDomain: string): string | null {
  try {
    const withScheme = /^https?:\/\//i.test(urlOrDomain) ? urlOrDomain : `https://${urlOrDomain}`
    return normaliseDomain(new URL(withScheme).hostname)
  } catch {
    return normaliseDomain(urlOrDomain) || null
  }
}

/** Match audited URL → connected_sites row + active site_connections for this user. */
export async function findOwnedSiteConnection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  auditUrl: string,
): Promise<OwnedSiteConnection | null> {
  const host = hostOf(auditUrl)
  if (!host) return null

  const { data: sites } = await supabase
    .from('connected_sites')
    .select('id, domain, brand')
    .eq('user_id', userId)

  const site = (sites || []).find((s: { domain: string }) => {
    const d = normaliseDomain(s.domain)
    return d === host || host.endsWith(`.${d}`) || d.endsWith(`.${host}`)
  })
  if (!site) return null

  const { data: conn } = await supabase
    .from('site_connections')
    .select('*')
    .eq('site_id', site.id)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!conn) return null

  const siteUrl = normaliseSiteUrl(site.domain) || `https://${site.domain}`
  const credentials = loadConnectionCredentials(conn)

  return {
    siteId: site.id,
    connectionId: conn.id,
    domain: site.domain,
    brand: site.brand || site.domain,
    cmsType: conn.cms_type || 'wordpress',
    siteUrl,
    credentials,
    lastVerifiedAt: conn.last_verified_at || null,
  }
}

/** Public-safe connection status for the audit UI (no secrets). */
export async function getSiteConnectionStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  auditUrl: string,
): Promise<{
  connected: boolean
  siteId?: string
  domain?: string
  brand?: string
  cmsType?: string
  lastVerifiedAt?: string | null
  prompt?: string
  fixableScope?: string
  isUniversalTag?: boolean
  canFixHeaders?: boolean
}> {
  const owned = await findOwnedSiteConnection(supabase, userId, auditUrl)
  if (!owned) {
    return {
      connected: false,
      prompt:
        'Connect this site in Settings → Your Sites (WordPress, Shopify, or GitHub) to enable the Fix Agent. Auditing a URL does not grant write access.',
    }
  }
  return {
    connected: true,
    siteId: owned.siteId,
    domain: owned.domain,
    brand: owned.brand,
    cmsType: owned.cmsType,
    lastVerifiedAt: owned.lastVerifiedAt,
    fixableScope: describeFixableScope(owned.cmsType),
    isUniversalTag: owned.cmsType === 'universal-tag',
    canFixHeaders: isServerCmsConnection(owned.cmsType),
  }
}

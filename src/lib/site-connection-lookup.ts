/**
 * Resolve whether an audited URL belongs to a user-owned, actively connected site.
 * Auditing any URL and having write access are separate permission states.
 *
 * Domain matching is exact-host first. A parent domain (autodun.com) must NOT
 * silently claim a subdomain audit (ev.autodun.com) — each registered host is
 * its own site entity for Fix Agent + GSC / Experiments.
 */

import { normaliseDomain } from './connected-sites'
import { loadConnectionCredentials } from './site-connection-crypto'
import { normaliseSiteUrl } from './wordpress-connector'
import { describeFixableScope, isServerCmsConnection } from './fix-agent-classification'
import { normalizeUrl } from '@/lib/supabase/audit-db'

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

export function hostOf(urlOrDomain: string): string | null {
  try {
    const withScheme = /^https?:\/\//i.test(urlOrDomain) ? urlOrDomain : `https://${urlOrDomain}`
    return normaliseDomain(new URL(withScheme).hostname)
  } catch {
    return normaliseDomain(urlOrDomain) || null
  }
}

/** Prefer exact host match; never fall back to parent/child suffix matching. */
export function pickExactSiteForHost<T extends { domain: string }>(
  sites: T[],
  host: string,
): T | null {
  const needle = normaliseDomain(host)
  if (!needle) return null
  return sites.find((s) => normaliseDomain(s.domain) === needle) || null
}

/** True when a parent-only registration would previously have swallowed this host. */
export function findParentSiteHint<T extends { domain: string }>(
  sites: T[],
  host: string,
): T | null {
  const needle = normaliseDomain(host)
  if (!needle) return null
  return (
    sites.find((s) => {
      const d = normaliseDomain(s.domain)
      return d !== needle && needle.endsWith(`.${d}`)
    }) || null
  )
}

/** Compare Fix Agent attempt URLs after normalizeUrl (www / slash / query). */
export function attemptUrlsMatch(stored: string, requested: string): boolean {
  if (!stored || !requested) return false
  if (stored === requested) return true
  try {
    return normalizeUrl(stored) === normalizeUrl(requested)
  } catch {
    return stored.replace(/\/$/, '') === requested.replace(/\/$/, '')
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

  type SiteRow = { id: string; domain: string; brand: string }
  const site = pickExactSiteForHost((sites || []) as SiteRow[], host)
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
  /** Parent site registered but this exact host is not — register the host separately. */
  needsExactSiteRegistration?: boolean
  suggestedDomain?: string
  parentDomain?: string
}> {
  const host = hostOf(auditUrl)
  const owned = await findOwnedSiteConnection(supabase, userId, auditUrl)
  if (owned) {
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

  if (host) {
    const { data: sites } = await supabase
      .from('connected_sites')
      .select('id, domain, brand')
      .eq('user_id', userId)
    const parent = findParentSiteHint(sites || [], host)
    if (parent) {
      return {
        connected: false,
        needsExactSiteRegistration: true,
        suggestedDomain: host,
        parentDomain: parent.domain,
        prompt:
          `This fix requires connecting ${host} — go to Settings to connect it. You have ${parent.domain} connected; each host needs its own site + CMS connection (GSC listing alone does not grant write access).`,
      }
    }
  }

  return {
    connected: false,
    prompt:
      'Connect this site in Settings → Your Sites (WordPress, Shopify, or GitHub) to enable the Fix Agent. Auditing a URL does not grant write access.',
  }
}

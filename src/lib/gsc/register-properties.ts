/**
 * Register selected Search Console properties as connected_sites + gsc_connections.
 * Account-level OAuth token is copied onto each per-site connection row.
 */

import { addConnectedSite, getConnectedSites, normaliseDomain } from '@/lib/connected-sites'
import { brandHintFromDomain, domainFromGscPropertyUrl } from '@/lib/gsc/property-domain'

export type RegisteredGscProperty = {
  propertyUrl: string
  domain: string
  siteId: string
  createdSite: boolean
  connectionId: string
}

export type RegisterGscPropertiesResult = {
  registered: RegisteredGscProperty[]
  skipped: Array<{ propertyUrl: string; reason: string }>
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function registerGscPropertiesForUser(
  supabase: any,
  opts: {
    userId: string
    propertyUrls: string[]
    refreshTokenEncrypted: string
    /** Property URLs the Google account is allowed to see (verified against API). */
    allowedPropertyUrls: Set<string>
  },
): Promise<RegisterGscPropertiesResult> {
  const registered: RegisteredGscProperty[] = []
  const skipped: Array<{ propertyUrl: string; reason: string }> = []
  const existing = await getConnectedSites(supabase, opts.userId)
  const byDomain = new Map(existing.map((s) => [normaliseDomain(s.domain), s]))

  const uniqueUrls = Array.from(
    new Set(opts.propertyUrls.map((u) => u.trim()).filter(Boolean)),
  )

  for (const propertyUrl of uniqueUrls) {
    if (!opts.allowedPropertyUrls.has(propertyUrl)) {
      skipped.push({
        propertyUrl,
        reason: 'Not a verified Search Console property for this Google account',
      })
      continue
    }

    const domain = domainFromGscPropertyUrl(propertyUrl)
    if (!domain) {
      skipped.push({ propertyUrl, reason: 'Could not derive a hostname from this property URL' })
      continue
    }

    let siteId: string | undefined
    let createdSite = false
    const match = byDomain.get(domain)
    if (match) {
      siteId = match.id
    } else {
      const brand = brandHintFromDomain(domain)
      const added = await addConnectedSite(supabase, opts.userId, domain, brand)
      if (!added.success || !added.siteId) {
        skipped.push({
          propertyUrl,
          reason: added.error || `Could not create site for ${domain}`,
        })
        continue
      }
      siteId = added.siteId
      createdSite = true
      byDomain.set(domain, {
        id: siteId,
        domain,
        brand,
        isPrimary: existing.length === 0 && registered.length === 0,
      })
    }

    const { data: conn, error } = await supabase
      .from('gsc_connections')
      .upsert(
        {
          user_id: opts.userId,
          site_id: siteId,
          property_url: propertyUrl,
          refresh_token_encrypted: opts.refreshTokenEncrypted,
          status: 'active',
          connected_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: 'site_id' },
      )
      .select('id')
      .single()

    if (error || !conn?.id) {
      skipped.push({
        propertyUrl,
        reason: error?.message || 'Could not save Search Console connection',
      })
      continue
    }

    registered.push({
      propertyUrl,
      domain,
      siteId,
      createdSite,
      connectionId: conn.id as string,
    })
  }

  return { registered, skipped }
}

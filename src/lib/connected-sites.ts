/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/connected-sites.ts
// The user's real domains. Every diagnostic tool reads from here rather than
// defaulting to a placeholder.

export interface ConnectedSite {
  id: string
  domain: string
  brand: string
  isPrimary: boolean
  /** Secret token for this site's Universal Tag snippet. */
  universalTagToken?: string | null
}

/** Normalise user input to a bare host: strips scheme, path, www and trailing slash. */
export function normaliseDomain(input: string): string {
  let d = input.trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '')
  d = d.replace(/^www\./, '')
  d = d.split('/')[0]
  d = d.replace(/\/+$/, '')
  return d
}

export async function getConnectedSites(
  supabase: any,
  userId: string
): Promise<ConnectedSite[]> {
  const { data } = await supabase
    .from('connected_sites')
    .select('id, domain, brand, is_primary, universal_tag_token')
    .eq('user_id', userId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  return (data || []).map((d: any) => ({
    id: d.id,
    domain: d.domain,
    brand: d.brand,
    isPrimary: d.is_primary,
    universalTagToken: d.universal_tag_token
  }))
}

export async function addConnectedSite(
  supabase: any,
  userId: string,
  domain: string,
  brand: string
): Promise<{ success: boolean; error?: string }> {
  const cleanDomain = normaliseDomain(domain)

  // Reject anything that isn't plausibly a hostname.
  if (!cleanDomain || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(cleanDomain)) {
    return { success: false, error: 'Enter a valid domain, e.g. autodun.com' }
  }

  const existing = await getConnectedSites(supabase, userId)
  if (existing.some(s => s.domain === cleanDomain)) {
    return { success: false, error: `${cleanDomain} is already connected.` }
  }

  const isFirst = existing.length === 0

  const { error } = await supabase
    .from('connected_sites')
    .insert({
      user_id: userId,
      domain: cleanDomain,
      brand,
      is_primary: isFirst   // first site added becomes primary automatically
    })

  if (error) {
    // The UNIQUE(user_id, domain) constraint is the backstop for a race.
    if ((error as any).code === '23505') {
      return { success: false, error: `${cleanDomain} is already connected.` }
    }
    return { success: false, error: error.message }
  }
  return { success: true }
}

export async function setPrimarySite(
  supabase: any,
  userId: string,
  siteId: string
): Promise<void> {
  await supabase.from('connected_sites').update({ is_primary: false }).eq('user_id', userId)
  await supabase.from('connected_sites').update({ is_primary: true }).eq('id', siteId)
}

export async function removeConnectedSite(
  supabase: any,
  siteId: string
): Promise<{ promotedNewPrimary: boolean }> {
  // If the removed site was primary, promote the next one so the app is never
  // left with sites but no primary.
  const { data: removed } = await supabase
    .from('connected_sites')
    .select('user_id, is_primary')
    .eq('id', siteId)
    .maybeSingle()

  await supabase.from('connected_sites').delete().eq('id', siteId)

  if (removed?.is_primary) {
    const remaining = await getConnectedSites(supabase, removed.user_id)
    if (remaining.length > 0) {
      await supabase.from('connected_sites').update({ is_primary: true }).eq('id', remaining[0].id)
      return { promotedNewPrimary: true }
    }
  }
  return { promotedNewPrimary: false }
}

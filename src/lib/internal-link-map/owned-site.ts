import type { SupabaseClient } from '@supabase/supabase-js'

export type OwnedSite = { id: string; domain: string; brand: string | null }

export async function loadOwnedConnectedSite(
  supabase: SupabaseClient,
  userId: string,
  siteId: string,
): Promise<OwnedSite | null> {
  if (!siteId || !userId) return null
  const { data, error } = await supabase
    .from('connected_sites')
    .select('id, domain, brand')
    .eq('id', siteId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  return {
    id: String(data.id),
    domain: String(data.domain),
    brand: (data.brand as string | null) ?? null,
  }
}

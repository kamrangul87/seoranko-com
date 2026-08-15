// src/lib/brand-settings.ts
// Server-side reads of brand_settings — mirrors internal-link-engine.ts's
// getEligibleLinks: service-role client (RLS bypassed by design, this
// route already knows and controls which user_id/brand it's querying for).

import { createClient } from '@supabase/supabase-js'

export interface BrandSettingsLookup {
  /** Row exists at all for this (user, brand) — distinct from "logoUrl is
   *  set". See schema-validator.ts expectOrganizationLogo / article-v2's
   *  Quality Gate pass-through when logo_url is unavailable. */
  configured: boolean
  logoUrl: string | null
}

export async function getBrandSettings(userId: string, brand: string): Promise<BrandSettingsLookup> {
  if (!userId || !brand) return { configured: false, logoUrl: null }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data } = await supabase
    .from('brand_settings')
    .select('logo_url')
    .eq('user_id', userId)
    .eq('brand', brand)
    .maybeSingle()

  if (!data) return { configured: false, logoUrl: null }
  return { configured: true, logoUrl: data.logo_url || null }
}

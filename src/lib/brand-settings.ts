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
  /** The brand_settings.brand value the row was actually found under. */
  matchedBrandKey?: string
}

/**
 * Ordered brand keys to look a row up under, most specific first.
 *
 * The lookup was a single exact `.eq('brand', brand)`, but `brand` is a
 * free-text field the generator receives in whatever form the request used
 * ("ev.autodun.com", "https://autodun.com", "Autodun") while the
 * brand_settings row was saved under one particular spelling ("autodun").
 * Any mismatch made the row invisible: `configured:false, logoUrl:null`, so
 * Organization.logo fell back to a derived candidate or was omitted — the
 * "logo doesn't flow through for this brand" failure. Matching over the
 * normalized variants makes the lookup independent of spelling.
 */
export function brandLookupCandidates(brand: string): string[] {
  const candidates: string[] = []
  const push = (value: string | undefined) => {
    const v = value?.trim()
    if (v && !candidates.includes(v)) candidates.push(v)
  }

  push(brand)
  const lower = brand.trim().toLowerCase()
  push(lower)

  // Strip scheme, credentials, path, port → bare host.
  const host = lower
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^@/]*@/, '')
    .split('/')[0]
    .split(':')[0]
    .replace(/^www\./, '')
  push(host)

  if (host.includes('.')) {
    const labels = host.split('.').filter(Boolean)
    // Registrable-ish domain: last two labels, or three for co.uk-style.
    if (labels.length >= 3 && /^(co|com|org|net|gov|ac)$/.test(labels[labels.length - 2])) {
      push(labels.slice(-3).join('.'))
    }
    if (labels.length >= 2) push(labels.slice(-2).join('.'))
    // Bare brand label ("autodun" from "ev.autodun.com").
    const registrable = labels.length >= 2 ? labels[labels.length - 2] : labels[0]
    if (registrable && !/^(co|com|org|net|gov|ac)$/.test(registrable)) push(registrable)
    else if (labels.length >= 3) push(labels[labels.length - 3])
  }

  return candidates
}

export async function getBrandSettings(userId: string, brand: string): Promise<BrandSettingsLookup> {
  if (!userId || !brand) return { configured: false, logoUrl: null }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const candidates = brandLookupCandidates(brand)

  const { data } = await supabase
    .from('brand_settings')
    .select('brand, logo_url')
    .eq('user_id', userId)
    .in('brand', candidates)

  return selectBrandSettingsRow(candidates, data)
}

/**
 * Pick the row to use: a row that actually has a logo wins over one that
 * doesn't, then the most specific candidate spelling.
 */
export function selectBrandSettingsRow(
  candidates: string[],
  rows: Array<{ brand?: string | null; logo_url?: string | null }> | null | undefined,
): BrandSettingsLookup {
  if (!rows || rows.length === 0) return { configured: false, logoUrl: null }

  const rank = (row: { brand?: string | null }) => {
    const key = (row.brand || '').trim().toLowerCase()
    const index = candidates.findIndex(c => c.trim().toLowerCase() === key)
    return index === -1 ? candidates.length : index
  }

  const sorted = [...rows].sort((a, b) => {
    const aLogo = a.logo_url?.trim() ? 0 : 1
    const bLogo = b.logo_url?.trim() ? 0 : 1
    if (aLogo !== bLogo) return aLogo - bLogo
    return rank(a) - rank(b)
  })

  const best = sorted[0]
  return {
    configured: true,
    logoUrl: best.logo_url?.trim() || null,
    matchedBrandKey: best.brand?.trim() || undefined,
  }
}

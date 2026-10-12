/**
 * Load privacy controller / jurisdiction settings for topic 72.
 * Missing jurisdiction → detector emits human-review-jurisdiction-not-set.
 */

import { createClient } from '@supabase/supabase-js'

export type PrivacySiteSettings = {
  jurisdiction: string | null
  controllerName: string | null
  controllerAddress: string | null
  contactEmail: string | null
  retentionSummary: string | null
  retentionAnalytics: string | null
  retentionForms: string | null
}

export async function loadPrivacySiteSettings(
  siteId: string | null | undefined,
): Promise<PrivacySiteSettings | null> {
  if (!siteId) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase
    .from('connected_sites')
    .select(
      'privacy_jurisdiction, privacy_controller_name, privacy_controller_address, privacy_contact_email, privacy_retention_summary, privacy_retention_analytics, privacy_retention_forms',
    )
    .eq('id', siteId)
    .maybeSingle()

  if (error || !data) return null
  return {
    jurisdiction: (data.privacy_jurisdiction as string | null) ?? null,
    controllerName: (data.privacy_controller_name as string | null) ?? null,
    controllerAddress:
      (data.privacy_controller_address as string | null) ?? null,
    contactEmail: (data.privacy_contact_email as string | null) ?? null,
    retentionSummary:
      (data.privacy_retention_summary as string | null) ?? null,
    retentionAnalytics:
      (data.privacy_retention_analytics as string | null) ?? null,
    retentionForms: (data.privacy_retention_forms as string | null) ?? null,
  }
}

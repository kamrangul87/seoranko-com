/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/treatment-log.ts
// §10 item 9 / §7.8 — treatment_id, applied_at, indexed_at, and the 28-day
// washout check. Scope is deliberately the §7.8 minimum (four requirements),
// not the full §7.7 experiment engine (units/assignments/effects) — that is
// item 17+, "once data supports it."

export const WASHOUT_DAYS = 28

export interface WashoutCheck {
  allowed: boolean
  reason: string
  daysSinceLastTreatment: number | null
}

/**
 * §7.3 / §7.8: "one live treatment per unit, no exceptions." Blocks a new
 * treatment if this unit had one applied within the last 28 days, regardless
 * of what triggered the new request.
 */
export async function checkWashout(supabase: any, unitId: string): Promise<WashoutCheck> {
  const { data } = await supabase
    .from('page_treatments')
    .select('applied_at')
    .eq('unit_id', unitId)
    .order('applied_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data?.applied_at) {
    return { allowed: true, reason: 'No prior treatment on record.', daysSinceLastTreatment: null }
  }

  const daysSince = (Date.now() - new Date(data.applied_at).getTime()) / 86400_000

  if (daysSince < WASHOUT_DAYS) {
    return {
      allowed: false,
      reason: `Washout: a treatment was applied ${Math.floor(daysSince)} day(s) ago — ${WASHOUT_DAYS}-day washout requires ${Math.ceil(WASHOUT_DAYS - daysSince)} more day(s) before another.`,
      daysSinceLastTreatment: Math.floor(daysSince)
    }
  }

  return { allowed: true, reason: `Last treatment was ${Math.floor(daysSince)} days ago — washout clear.`, daysSinceLastTreatment: Math.floor(daysSince) }
}

/**
 * Same washout rule for site-level fixes (WordPress/Shopify/Webflow/GitHub/
 * Universal Tag schema and content injections). The unit here is a
 * site+URL pair, not a ranking_agent_articles row, so this checks
 * site_autofix_log directly rather than page_treatments.
 */
export async function checkSiteWashout(
  supabase: any,
  siteId: string,
  targetUrl: string
): Promise<WashoutCheck> {
  const { data } = await supabase
    .from('site_autofix_log')
    .select('applied_at')
    .eq('site_id', siteId)
    .eq('target_url', targetUrl)
    .order('applied_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data?.applied_at) {
    return { allowed: true, reason: 'No prior treatment on record.', daysSinceLastTreatment: null }
  }

  const daysSince = (Date.now() - new Date(data.applied_at).getTime()) / 86400_000

  if (daysSince < WASHOUT_DAYS) {
    return {
      allowed: false,
      reason: `Washout: a fix was applied to this page ${Math.floor(daysSince)} day(s) ago — ${WASHOUT_DAYS}-day washout requires ${Math.ceil(WASHOUT_DAYS - daysSince)} more day(s) before another.`,
      daysSinceLastTreatment: Math.floor(daysSince)
    }
  }

  return { allowed: true, reason: `Last fix was ${Math.floor(daysSince)} days ago — washout clear.`, daysSinceLastTreatment: Math.floor(daysSince) }
}

/**
 * Record a content-level treatment. `treatmentId` is a T01-T10 catalog id
 * when one cleanly applies; otherwise pass null and use `legacyTarget` — the
 * current Ranking Agent's coarse eeat/readability/human_score/fact_sourcing/all
 * vocabulary doesn't map 1:1 onto §7.1's atomic treatments yet (Station 8
 * redesign, item 12). Never throws — logging must not break the action it logs.
 */
export async function logPageTreatment(
  supabase: any,
  params: {
    userId: string | null
    unitId: string
    treatmentId?: string | null
    legacyTarget?: string | null
    keyword: string
    triggerReason?: string | null
    changesSummary?: string | null
  }
): Promise<void> {
  try {
    await supabase.from('page_treatments').insert({
      user_id: params.userId,
      unit_id: params.unitId,
      treatment_id: params.treatmentId ?? null,
      legacy_target: params.legacyTarget ?? null,
      keyword: params.keyword,
      trigger_reason: params.triggerReason ?? null,
      changes_summary: params.changesSummary ?? null
    })
  } catch (err) {
    console.error('[treatment-log] logPageTreatment failed:', err)
  }
}

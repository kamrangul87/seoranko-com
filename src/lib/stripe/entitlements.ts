/**
 * Launch entitlements for Fix Agent writes + crawl volume.
 * Source of truth: `subscriptions` (Stripe-synced). Master email bypasses
 * for dogfood. Do not use legacy `user_profiles.plan`.
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'
import { hasManageableSubscription } from './plans'

export type EntitlementDenial = {
  ok: false
  status: 402
  code: 'SUBSCRIPTION_REQUIRED'
  error: string
  billingPath: '/dashboard/billing'
}

export type EntitlementOk = { ok: true; reason: 'subscription' | 'master' }

export function isMasterUserEmail(email: string | null | undefined): boolean {
  const master = process.env.MASTER_EMAIL?.trim().toLowerCase()
  if (!master || !email) return false
  return email.trim().toLowerCase() === master
}

export async function loadSubscriptionStatus(
  userId: string,
): Promise<string | null> {
  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('subscriptions')
    .select('status')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    throw new Error(`subscriptions entitlement lookup failed: ${error.message}`)
  }
  return (data?.status as string | undefined) ?? null
}

export async function assertFixWriteEntitled(input: {
  userId: string
  email?: string | null
}): Promise<EntitlementOk | EntitlementDenial> {
  if (isMasterUserEmail(input.email)) {
    return { ok: true, reason: 'master' }
  }
  const status = await loadSubscriptionStatus(input.userId)
  if (hasManageableSubscription(status)) {
    return { ok: true, reason: 'subscription' }
  }
  return {
    ok: false,
    status: 402,
    code: 'SUBSCRIPTION_REQUIRED',
    error:
      'Applying fixes requires an active SEORANKO subscription. Detect-only audits stay free — upgrade to commit fixes to your site.',
    billingPath: '/dashboard/billing',
  }
}

/** Daily crawl start limit for this user (UTC day). Master → subscribed tier. */
export async function crawlDailyLimitForUser(input: {
  userId: string
  email?: string | null
}): Promise<number> {
  if (isMasterUserEmail(input.email)) {
    return FIX_STRATEGY_PRODUCT_DECISIONS.crawlRunsPerUserPerDaySubscribed
  }
  try {
    const status = await loadSubscriptionStatus(input.userId)
    if (hasManageableSubscription(status)) {
      return FIX_STRATEGY_PRODUCT_DECISIONS.crawlRunsPerUserPerDaySubscribed
    }
  } catch {
    // Fail closed to free tier if subscription lookup fails
  }
  return FIX_STRATEGY_PRODUCT_DECISIONS.crawlRunsPerUserPerDayFree
}

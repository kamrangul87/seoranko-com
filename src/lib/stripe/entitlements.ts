/**
 * Launch entitlements for Fix Agent writes + crawl volume / page caps.
 * Source of truth: `subscriptions` (Stripe-synced). Master email bypasses
 * for dogfood. Do not use legacy `user_profiles.plan`.
 */

import type Stripe from 'stripe'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'
import { getStripe } from './client'
import {
  DEFAULT_SEORANKO_PLAN_ID,
  SEORANKO_PLANS,
  getSeorankoPlan,
  hasManageableSubscription,
  type SeorankoPlanId,
} from './plans'

export type EntitlementDenial = {
  ok: false
  status: 402
  code: 'SUBSCRIPTION_REQUIRED'
  error: string
  billingPath: '/dashboard/billing'
  /** Structured copy for the findings/fix UI upgrade prompt (not a raw 402). */
  upgrade: {
    title: string
    body: string
    benefits: string[]
    ctaLabel: string
  }
}

export type EntitlementOk = { ok: true; reason: 'subscription' | 'master' }

export type CrawlPageQuota = {
  maxPages: number
  /** Short plan name for UI: "free" | plan label (e.g. "Starter"). */
  planLabel: string
  isFree: boolean
}

export function isMasterUserEmail(email: string | null | undefined): boolean {
  const master = process.env.MASTER_EMAIL?.trim().toLowerCase()
  if (!master || !email) return false
  return email.trim().toLowerCase() === master
}

type SubscriptionEntitlementRow = {
  status: string
  plan_id: string | null
  stripe_subscription_id: string | null
}

export async function loadSubscriptionEntitlement(
  userId: string,
): Promise<SubscriptionEntitlementRow | null> {
  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('subscriptions')
    .select('status, plan_id, stripe_subscription_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    throw new Error(`subscriptions entitlement lookup failed: ${error.message}`)
  }
  return (data as SubscriptionEntitlementRow | null) ?? null
}

/** @deprecated Prefer loadSubscriptionEntitlement — kept for narrow status checks. */
export async function loadSubscriptionStatus(
  userId: string,
): Promise<string | null> {
  const row = await loadSubscriptionEntitlement(userId)
  return row?.status ?? null
}

export async function assertFixWriteEntitled(input: {
  userId: string
  email?: string | null
}): Promise<EntitlementOk | EntitlementDenial> {
  if (isMasterUserEmail(input.email)) {
    return { ok: true, reason: 'master' }
  }
  const row = await loadSubscriptionEntitlement(input.userId)
  if (hasManageableSubscription(row?.status)) {
    return { ok: true, reason: 'subscription' }
  }
  const paidPages = FIX_STRATEGY_PRODUCT_DECISIONS.crawlPagesPerRunPaidDefault
  return {
    ok: false,
    status: 402,
    code: 'SUBSCRIPTION_REQUIRED',
    error:
      'Applying fixes requires an active SEORANKO subscription. Detect-only audits stay free — upgrade to commit fixes to your site.',
    billingPath: '/dashboard/billing',
    upgrade: {
      title: 'Upgrade to apply this fix',
      body: 'Detection, findings, and “why we did not fix this” stay free. Committing a fix to your connected site needs a subscription.',
      benefits: [
        'Commit Fix Agent changes via pull request',
        `Crawl up to ${paidPages} pages per run (vs ${FIX_STRATEGY_PRODUCT_DECISIONS.crawlPagesPerRunFree} on free)`,
        `Up to ${FIX_STRATEGY_PRODUCT_DECISIONS.crawlRunsPerUserPerDaySubscribed} crawl starts per day`,
      ],
      ctaLabel: 'View billing & upgrade',
    },
  }
}

function parsePositiveInt(raw: string | null | undefined): number | null {
  if (!raw) return null
  const n = Number.parseInt(String(raw).trim(), 10)
  if (!Number.isFinite(n) || n < 1) return null
  return n
}

/**
 * Authoritative per-plan page cap from SEORANKO_PLANS (Starter 100 / Pro 500 /
 * Agency 2000). Unknown plan ids → Starter (lowest paid), never Pro's 500.
 */
export function crawlPagesCapForPlanId(
  planId: string | null | undefined,
): number {
  if (planId && planId in SEORANKO_PLANS) {
    return SEORANKO_PLANS[planId as SeorankoPlanId].pagesPerCrawlDisplay
  }
  return SEORANKO_PLANS[DEFAULT_SEORANKO_PLAN_ID].pagesPerCrawlDisplay
}

/**
 * Paid page limit from Stripe Price → Product → Subscription metadata.
 * Keys tried: product-decisions crawlPagesStripeMetadataKey, then crawl_pages_per_run.
 * Missing/unreadable metadata → log error and fall back to Starter (100), never 500.
 */
export async function paidCrawlPagesFromStripe(
  stripeSubscriptionId: string | null | undefined,
): Promise<number> {
  const starterFallback =
    SEORANKO_PLANS[DEFAULT_SEORANKO_PLAN_ID].pagesPerCrawlDisplay
  if (!stripeSubscriptionId?.trim()) {
    console.error(
      '[entitlements] paidCrawlPagesFromStripe: missing stripe_subscription_id; falling back to Starter page cap',
      { fallback: starterFallback },
    )
    return starterFallback
  }
  if (!process.env.STRIPE_SECRET_KEY?.trim()) {
    console.error(
      '[entitlements] paidCrawlPagesFromStripe: STRIPE_SECRET_KEY unset; falling back to Starter page cap',
      { fallback: starterFallback },
    )
    return starterFallback
  }

  try {
    const stripe = getStripe()
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
      expand: ['items.data.price.product'],
    })
    const primaryKey = FIX_STRATEGY_PRODUCT_DECISIONS.crawlPagesStripeMetadataKey
    const altKey = 'crawl_pages_per_run'

    const fromMeta = (meta: Stripe.Metadata | null | undefined) =>
      parsePositiveInt(meta?.[primaryKey]) ?? parsePositiveInt(meta?.[altKey])

    const price = sub.items.data[0]?.price
    const fromPrice = fromMeta(price?.metadata)
    if (fromPrice != null) return fromPrice

    const product = price?.product
    if (product && typeof product !== 'string' && !('deleted' in product && product.deleted)) {
      const fromProduct = fromMeta((product as Stripe.Product).metadata)
      if (fromProduct != null) return fromProduct
    }

    const fromSub = fromMeta(sub.metadata)
    if (fromSub != null) return fromSub

    console.error(
      '[entitlements] paidCrawlPagesFromStripe: no crawl page metadata on Price/Product/Subscription; falling back to Starter page cap',
      {
        stripeSubscriptionId,
        priceId: typeof price?.id === 'string' ? price.id : null,
        fallback: starterFallback,
      },
    )
  } catch (err) {
    console.error(
      '[entitlements] paidCrawlPagesFromStripe: Stripe lookup failed; falling back to Starter page cap',
      {
        stripeSubscriptionId,
        fallback: starterFallback,
        error: err instanceof Error ? err.message : String(err),
      },
    )
  }
  return starterFallback
}

/** Per-crawl page enqueue limit + plan label for coverage notes / UI. */
export async function crawlPageQuotaForUser(input: {
  userId: string
  email?: string | null
}): Promise<CrawlPageQuota> {
  if (isMasterUserEmail(input.email)) {
    // Dogfood: Agency enqueue cap (hard safety still CRAWL_MAX_DISCOVERED).
    return {
      maxPages: crawlPagesCapForPlanId('seoranko_agency'),
      planLabel: getSeorankoPlan('seoranko_agency').label,
      isFree: false,
    }
  }
  try {
    const row = await loadSubscriptionEntitlement(input.userId)
    if (hasManageableSubscription(row?.status)) {
      const maxPages = await paidCrawlPagesFromStripe(row?.stripe_subscription_id)
      const planLabel = getSeorankoPlan(row?.plan_id || DEFAULT_SEORANKO_PLAN_ID).label
      return { maxPages, planLabel, isFree: false }
    }
  } catch {
    // Fail closed to free tier
  }
  return {
    maxPages: FIX_STRATEGY_PRODUCT_DECISIONS.crawlPagesPerRunFree,
    planLabel: 'free',
    isFree: true,
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

/**
 * User-facing line when a crawl hit the plan page cap.
 * Example: "25 of 180 pages crawled — free plan limit"
 */
export function formatPlanPageLimitMessage(input: {
  crawledOrEnqueued: number
  found: number
  planLabel: string
}): string {
  return `${input.crawledOrEnqueued} of ${input.found} pages crawled — ${input.planLabel} plan limit`
}

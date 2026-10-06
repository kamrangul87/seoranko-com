/**
 * SEORANKO billing plans — config-only, single source of truth for plan
 * content. Read by checkout/webhook (id, priceEnvVar), and by every
 * display surface (signup, homepage, billing, upgrade prompts) for label,
 * price and feature copy — so those surfaces cannot drift from each other
 * or from what checkout actually sells.
 *
 * Swap price IDs / add tiers later without touching checkout or webhook
 * code: set the env var named by priceEnvVar to the real Stripe Price id.
 *
 * pagesPerCrawlDisplay is marketing copy only — crawl page caps are still
 * enforced via entitlements + Stripe Price metadata (see entitlements.ts).
 */

import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

export const SEORANKO_STRIPE_APP = 'seoranko' as const

export type SeorankoPlanId = 'seoranko_starter' | 'seoranko_pro' | 'seoranko_agency'

export const DEFAULT_SEORANKO_PLAN_ID: SeorankoPlanId = 'seoranko_starter'

export type SeorankoPlan = {
  id: SeorankoPlanId
  label: string
  /** Display price, e.g. "£29/mo". Not a Stripe amount — the real price lives on the Stripe Price object. */
  priceDisplay: string
  tagline: string
  description: string
  /** Display-only pages-per-crawl figure for pricing UI. Not entitlement logic. */
  pagesPerCrawlDisplay: number
  features: string[]
  /** Env var that holds the Stripe Price ID for this plan. */
  priceEnvVar: 'STRIPE_STARTER_PRICE_ID' | 'STRIPE_PRO_PRICE_ID' | 'STRIPE_AGENCY_PRICE_ID'
}

/**
 * True of every paid tier today: checkout and entitlements only
 * distinguish "subscribed" from "free" (src/lib/stripe/entitlements.ts),
 * not one paid tier from another. The one real per-tier lever that
 * already exists is crawl-pages-per-run, which paidCrawlPagesFromStripe()
 * reads from the subscribed Stripe Price's metadata
 * (FIX_STRATEGY_PRODUCT_DECISIONS.crawlPagesStripeMetadataKey) — set that
 * metadata key differently on each of the three real Stripe Prices to
 * make Starter/Pro/Agency actually enforce different crawl sizes. Until
 * that metadata is set, all three unlock the same allowance. Do not add
 * copy here implying a hard difference (e.g. a site-count cap) that nothing
 * in the code enforces.
 */
const SHARED_FEATURES_TAIL = [
  'Full site crawl and audit',
  'Findings with a plain-English explanation, a why-not-fixed reason, and a source link',
  'Agentic fixes committed to your connected repo via pull request',
  'Weekly re-crawl with an in-product report of what changed',
]

function paidFeatures(pagesPerCrawlDisplay: number): string[] {
  return [`Up to ${pagesPerCrawlDisplay} pages per crawl`, ...SHARED_FEATURES_TAIL]
}

export const SEORANKO_PLANS: Record<SeorankoPlanId, SeorankoPlan> = {
  seoranko_starter: {
    id: 'seoranko_starter',
    label: 'Starter',
    priceDisplay: '£29/mo',
    tagline: 'One site, done properly',
    description: 'Site audit and agentic fix for a single site.',
    pagesPerCrawlDisplay: 100,
    features: paidFeatures(100),
    priceEnvVar: 'STRIPE_STARTER_PRICE_ID',
  },
  seoranko_pro: {
    id: 'seoranko_pro',
    label: 'Pro',
    priceDisplay: '£79/mo',
    tagline: 'For a growing site or a small team',
    description: 'Everything in Starter, sized for a larger site.',
    pagesPerCrawlDisplay: 500,
    features: paidFeatures(500),
    priceEnvVar: 'STRIPE_PRO_PRICE_ID',
  },
  seoranko_agency: {
    id: 'seoranko_agency',
    label: 'Agency',
    priceDisplay: '£149/mo',
    tagline: 'For agencies managing client sites',
    description: 'Everything in Pro, for teams managing more than one site.',
    pagesPerCrawlDisplay: 2000,
    features: paidFeatures(2000),
    priceEnvVar: 'STRIPE_AGENCY_PRICE_ID',
  },
}

/** Free tier — detect-only, no Stripe price, shown alongside SEORANKO_PLANS on display surfaces. */
export const SEORANKO_FREE_PLAN = {
  id: 'free' as const,
  label: 'Free',
  priceDisplay: '£0',
  tagline: 'Try it on your own site',
  description: 'Detect-only site audits — no card required.',
  features: [
    'Full site crawl and audit',
    'Findings with a plain-English explanation, a why-not-fixed reason, and a source link',
    `Up to ${FIX_STRATEGY_PRODUCT_DECISIONS.crawlPagesPerRunFree} pages per crawl, ${FIX_STRATEGY_PRODUCT_DECISIONS.crawlRunsPerUserPerDayFree} crawl starts per day`,
  ],
}

export function getSeorankoPlan(planId: string = DEFAULT_SEORANKO_PLAN_ID): SeorankoPlan {
  const plan = SEORANKO_PLANS[planId as SeorankoPlanId]
  if (!plan) {
    // Unknown stored plan_id (legacy / future) — still surface a safe label
    return {
      id: DEFAULT_SEORANKO_PLAN_ID,
      label: planId,
      priceDisplay: '',
      tagline: '',
      description: 'SEORANKO plan',
      pagesPerCrawlDisplay: 100,
      features: [],
      priceEnvVar: 'STRIPE_STARTER_PRICE_ID',
    }
  }
  return plan
}

/** Resolve Stripe Price ID from env — never hardcode price IDs in application code. */
export function resolvePlanPriceId(planId: string = DEFAULT_SEORANKO_PLAN_ID): string {
  const plan = getSeorankoPlan(planId)
  const priceId = process.env[plan.priceEnvVar]?.trim()
  if (!priceId) {
    throw new Error(
      `Missing ${plan.priceEnvVar}. Create a Product + Price in Stripe Dashboard → ` +
        `Products, then set this env var to the price_… id.`
    )
  }
  return priceId
}

export function isSeorankoStripeApp(metadata: Record<string, string> | null | undefined): boolean {
  return metadata?.app === SEORANKO_STRIPE_APP
}

/** Statuses that mean the user can open Customer Portal / is "subscribed". */
export function hasManageableSubscription(status: string | null | undefined): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due'
}

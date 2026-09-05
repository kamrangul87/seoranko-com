/**
 * SEORANKO billing plans — config-only.
 * Swap price IDs / add tiers later without touching checkout or webhook code.
 */

export const SEORANKO_STRIPE_APP = 'seoranko' as const

export const DEFAULT_SEORANKO_PLAN_ID = 'seoranko_starter' as const

export type SeorankoPlanId = typeof DEFAULT_SEORANKO_PLAN_ID

export type SeorankoPlan = {
  id: SeorankoPlanId
  label: string
  description: string
  /** Env var that holds the Stripe Price ID for this plan. */
  priceEnvVar: 'STRIPE_PLACEHOLDER_PRICE_ID'
}

export const SEORANKO_PLANS: Record<SeorankoPlanId, SeorankoPlan> = {
  seoranko_starter: {
    id: 'seoranko_starter',
    label: 'Starter',
    description: 'Placeholder SEORANKO subscription tier. Final pricing will replace this via env config.',
    priceEnvVar: 'STRIPE_PLACEHOLDER_PRICE_ID',
  },
}

export function getSeorankoPlan(planId: string = DEFAULT_SEORANKO_PLAN_ID): SeorankoPlan {
  const plan = SEORANKO_PLANS[planId as SeorankoPlanId]
  if (!plan) {
    // Unknown stored plan_id (legacy / future) — still surface a safe label
    return {
      id: DEFAULT_SEORANKO_PLAN_ID,
      label: planId,
      description: 'SEORANKO plan',
      priceEnvVar: 'STRIPE_PLACEHOLDER_PRICE_ID',
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

import Stripe from 'stripe'
import { SEORANKO_STRIPE_APP } from './plans'

let stripeSingleton: Stripe | null = null

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(key, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    })
  }
  return stripeSingleton
}

/**
 * Public app origin for Checkout / Portal return URLs.
 * Prefer NEXT_PUBLIC_APP_URL; fall back to request origin when provided.
 */
export function getAppOrigin(requestUrl?: string): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  if (requestUrl) {
    try {
      return new URL(requestUrl).origin
    } catch {
      /* ignore */
    }
  }
  return 'http://localhost:3000'
}

/** Customer metadata — namespaces this customer to SEORANKO on the shared Stripe account. */
export function seorankoCustomerMetadata(userId: string): Record<string, string> {
  return {
    app: SEORANKO_STRIPE_APP,
    seoranko_user_id: userId,
  }
}

/** Subscription / Checkout Session metadata linking back to Supabase auth.users. */
export function seorankoSubscriptionMetadata(
  userId: string,
  planId: string
): Record<string, string> {
  return {
    app: SEORANKO_STRIPE_APP,
    seoranko_user_id: userId,
    seoranko_plan_id: planId,
  }
}

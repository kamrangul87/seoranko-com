import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_SEORANKO_PLAN_ID, SEORANKO_STRIPE_APP } from './plans'

export type SubscriptionRow = {
  id: string
  user_id: string
  stripe_customer_id: string
  stripe_subscription_id: string
  plan_id: string
  status: string
  current_period_end: string | null
  created_at: string
  updated_at: string
}

export function periodEndIso(subscription: Stripe.Subscription): string | null {
  const end = subscription.current_period_end
  if (!end) return null
  return new Date(end * 1000).toISOString()
}

export function planIdFromSubscription(subscription: Stripe.Subscription): string {
  return (
    subscription.metadata?.seoranko_plan_id ||
    DEFAULT_SEORANKO_PLAN_ID
  )
}

export function userIdFromStripeObject(
  metadata: Stripe.Metadata | null | undefined
): string | null {
  const id = metadata?.seoranko_user_id?.trim()
  return id || null
}

export function belongsToSeoranko(
  metadata: Stripe.Metadata | null | undefined
): boolean {
  return metadata?.app === SEORANKO_STRIPE_APP
}

export async function upsertSubscriptionRow(
  admin: SupabaseClient,
  row: {
    user_id: string
    stripe_customer_id: string
    stripe_subscription_id: string
    plan_id: string
    status: string
    current_period_end: string | null
  }
): Promise<void> {
  // One SEORANKO subscription row per user — re-subscribe updates the same row.
  const { error } = await admin.from('subscriptions').upsert(
    {
      user_id: row.user_id,
      stripe_customer_id: row.stripe_customer_id,
      stripe_subscription_id: row.stripe_subscription_id,
      plan_id: row.plan_id,
      status: row.status,
      current_period_end: row.current_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )
  if (error) {
    throw new Error(`subscriptions upsert failed: ${error.message}`)
  }
}

export async function findSubscriptionByStripeId(
  admin: SupabaseClient,
  stripeSubscriptionId: string
): Promise<SubscriptionRow | null> {
  const { data, error } = await admin
    .from('subscriptions')
    .select('*')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .maybeSingle()
  if (error) {
    throw new Error(`subscriptions lookup failed: ${error.message}`)
  }
  return (data as SubscriptionRow | null) ?? null
}

export async function updateSubscriptionStatus(
  admin: SupabaseClient,
  stripeSubscriptionId: string,
  patch: {
    status: string
    current_period_end?: string | null
    plan_id?: string
  }
): Promise<boolean> {
  const payload: Record<string, unknown> = {
    status: patch.status,
    updated_at: new Date().toISOString(),
  }
  if (patch.current_period_end !== undefined) {
    payload.current_period_end = patch.current_period_end
  }
  if (patch.plan_id) {
    payload.plan_id = patch.plan_id
  }

  const { data, error } = await admin
    .from('subscriptions')
    .update(payload)
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .select('id')

  if (error) {
    throw new Error(`subscriptions update failed: ${error.message}`)
  }
  return (data?.length ?? 0) > 0
}

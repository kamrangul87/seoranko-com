import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getStripe } from './client'
import {
  belongsToSeoranko,
  findSubscriptionByStripeId,
  periodEndIso,
  planIdFromSubscription,
  updateSubscriptionStatus,
  upsertSubscriptionRow,
  userIdFromStripeObject,
} from './subscriptions-db'
import { DEFAULT_SEORANKO_PLAN_ID } from './plans'

export type WebhookHandleResult = {
  handled: boolean
  reason?: string
}

function customerIdFrom(value: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if ('deleted' in value && value.deleted) return null
  return value.id
}

async function resolveUserIdForSubscription(
  admin: SupabaseClient,
  subscription: Stripe.Subscription
): Promise<string | null> {
  const fromSub = userIdFromStripeObject(subscription.metadata)
  if (fromSub) return fromSub

  const existing = await findSubscriptionByStripeId(admin, subscription.id)
  if (existing?.user_id) return existing.user_id

  const customerId = customerIdFrom(subscription.customer)
  if (!customerId) return null

  try {
    const customer = await getStripe().customers.retrieve(customerId)
    if (customer.deleted) return null
    return userIdFromStripeObject(customer.metadata)
  } catch {
    return null
  }
}

async function syncSubscription(
  admin: SupabaseClient,
  subscription: Stripe.Subscription,
  userIdHint?: string | null
): Promise<WebhookHandleResult> {
  if (!belongsToSeoranko(subscription.metadata)) {
    // Also accept if customer is tagged seoranko (checkout may set customer metadata only)
    const customerId = customerIdFrom(subscription.customer)
    let customerOk = false
    if (customerId) {
      try {
        const customer = await getStripe().customers.retrieve(customerId)
        if (!customer.deleted && belongsToSeoranko(customer.metadata)) {
          customerOk = true
        }
      } catch {
        /* ignore */
      }
    }
    if (!customerOk) {
      return { handled: false, reason: 'not_seoranko' }
    }
  }

  const userId = userIdHint || (await resolveUserIdForSubscription(admin, subscription))
  if (!userId) {
    return { handled: false, reason: 'missing_seoranko_user_id' }
  }

  const customerId = customerIdFrom(subscription.customer)
  if (!customerId) {
    return { handled: false, reason: 'missing_customer' }
  }

  await upsertSubscriptionRow(admin, {
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    plan_id: planIdFromSubscription(subscription),
    status: subscription.status,
    current_period_end: periodEndIso(subscription),
  })

  return { handled: true }
}

async function handleCheckoutCompleted(
  admin: SupabaseClient,
  session: Stripe.Checkout.Session
): Promise<WebhookHandleResult> {
  if (session.mode !== 'subscription') {
    return { handled: false, reason: 'not_subscription_mode' }
  }

  if (!belongsToSeoranko(session.metadata)) {
    return { handled: false, reason: 'not_seoranko' }
  }

  const userId = userIdFromStripeObject(session.metadata)
  if (!userId) {
    return { handled: false, reason: 'missing_seoranko_user_id' }
  }

  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id

  if (!subscriptionId) {
    return { handled: false, reason: 'missing_subscription_id' }
  }

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId)
  return syncSubscription(admin, subscription, userId)
}

async function handleSubscriptionUpdated(
  admin: SupabaseClient,
  subscription: Stripe.Subscription
): Promise<WebhookHandleResult> {
  return syncSubscription(admin, subscription)
}

async function handleSubscriptionDeleted(
  admin: SupabaseClient,
  subscription: Stripe.Subscription
): Promise<WebhookHandleResult> {
  if (!belongsToSeoranko(subscription.metadata)) {
    const existing = await findSubscriptionByStripeId(admin, subscription.id)
    if (!existing) {
      return { handled: false, reason: 'not_seoranko' }
    }
  }

  const updated = await updateSubscriptionStatus(admin, subscription.id, {
    status: 'canceled',
    current_period_end: periodEndIso(subscription),
    plan_id: planIdFromSubscription(subscription),
  })

  if (!updated) {
    // Row may not exist yet — upsert canceled state if we can resolve user
    const sync = await syncSubscription(admin, {
      ...subscription,
      status: 'canceled',
    })
    return sync.handled ? { handled: true } : { handled: false, reason: 'subscription_not_found' }
  }

  return { handled: true }
}

async function handleInvoicePaymentFailed(
  admin: SupabaseClient,
  invoice: Stripe.Invoice
): Promise<WebhookHandleResult> {
  const subscriptionId =
    typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id

  if (!subscriptionId) {
    return { handled: false, reason: 'missing_subscription_id' }
  }

  const existing = await findSubscriptionByStripeId(admin, subscriptionId)
  if (!existing) {
    // May be another product on the shared account
    return { handled: false, reason: 'not_seoranko_or_unknown' }
  }

  await updateSubscriptionStatus(admin, subscriptionId, {
    status: 'past_due',
  })

  return { handled: true }
}

/**
 * Process a verified Stripe event. Non-SEORANKO / unknown types return handled:false
 * without throwing — caller should still respond 200.
 */
export async function handleStripeEvent(
  admin: SupabaseClient,
  event: Stripe.Event
): Promise<WebhookHandleResult> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(
        admin,
        event.data.object as Stripe.Checkout.Session
      )
    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(
        admin,
        event.data.object as Stripe.Subscription
      )
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(
        admin,
        event.data.object as Stripe.Subscription
      )
    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(
        admin,
        event.data.object as Stripe.Invoice
      )
    default:
      return { handled: false, reason: `unrecognized_event:${event.type}` }
  }
}

export { DEFAULT_SEORANKO_PLAN_ID }

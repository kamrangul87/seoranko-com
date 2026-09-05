import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { handleStripeEvent } from './webhook-handlers'
import { SEORANKO_STRIPE_APP } from './plans'

const retrieveSubscription = vi.fn()
const retrieveCustomer = vi.fn()

vi.mock('./client', () => ({
  getStripe: () => ({
    subscriptions: { retrieve: retrieveSubscription },
    customers: { retrieve: retrieveCustomer },
  }),
}))

function mockAdmin(opts?: {
  findBySub?: Record<string, unknown> | null
  upsertError?: string | null
  updateCount?: number
}) {
  const upsert = vi.fn().mockResolvedValue({ error: opts?.upsertError ? { message: opts.upsertError } : null })
  const updateSelect = vi.fn().mockResolvedValue({
    data: Array.from({ length: opts?.updateCount ?? 1 }, (_, i) => ({ id: `id-${i}` })),
    error: null,
  })
  const updateEq = vi.fn(() => ({ select: updateSelect }))
  const update = vi.fn(() => ({ eq: updateEq }))

  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts?.findBySub ?? null,
    error: null,
  })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn((table: string) => {
    expect(table).toBe('subscriptions')
    return { upsert, update, select }
  })

  return {
    admin: { from } as unknown as SupabaseClient,
    upsert,
    update,
    updateEq,
    select,
  }
}

describe('handleStripeEvent (SEORANKO namespace)', () => {
  beforeEach(() => {
    retrieveSubscription.mockReset()
    retrieveCustomer.mockReset()
  })

  it('ignores unrecognized event types without throwing', async () => {
    const { admin, upsert } = mockAdmin()
    const result = await handleStripeEvent(admin, {
      type: 'charge.succeeded',
      data: { object: {} },
    } as unknown as Stripe.Event)
    expect(result.handled).toBe(false)
    expect(result.reason).toMatch(/unrecognized_event/)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('ignores checkout.session.completed without seoranko app metadata', async () => {
    const { admin, upsert } = mockAdmin()
    const result = await handleStripeEvent(admin, {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          metadata: { app: 'minso_furniture' },
          subscription: 'sub_other',
        },
      },
    } as unknown as Stripe.Event)
    expect(result).toEqual({ handled: false, reason: 'not_seoranko' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('upserts subscription on checkout.session.completed for SEORANKO', async () => {
    const { admin, upsert } = mockAdmin()
    retrieveSubscription.mockResolvedValue({
      id: 'sub_seoranko_1',
      status: 'active',
      customer: 'cus_1',
      current_period_end: 1_800_000_000,
      metadata: {
        app: SEORANKO_STRIPE_APP,
        seoranko_user_id: 'user-abc',
        seoranko_plan_id: 'seoranko_starter',
      },
    })

    const result = await handleStripeEvent(admin, {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          metadata: {
            app: SEORANKO_STRIPE_APP,
            seoranko_user_id: 'user-abc',
            seoranko_plan_id: 'seoranko_starter',
          },
          subscription: 'sub_seoranko_1',
        },
      },
    } as unknown as Stripe.Event)

    expect(result.handled).toBe(true)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-abc',
        stripe_customer_id: 'cus_1',
        stripe_subscription_id: 'sub_seoranko_1',
        plan_id: 'seoranko_starter',
        status: 'active',
      }),
      { onConflict: 'user_id' }
    )
  })

  it('marks past_due on invoice.payment_failed when row exists', async () => {
    const { admin, update, updateEq } = mockAdmin({
      findBySub: {
        id: 'row-1',
        user_id: 'user-abc',
        stripe_subscription_id: 'sub_1',
      },
    })

    const result = await handleStripeEvent(admin, {
      type: 'invoice.payment_failed',
      data: {
        object: {
          subscription: 'sub_1',
        },
      },
    } as unknown as Stripe.Event)

    expect(result.handled).toBe(true)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'past_due' })
    )
    expect(updateEq).toHaveBeenCalledWith('stripe_subscription_id', 'sub_1')
  })

  it('skips invoice.payment_failed for unknown subscription (other product)', async () => {
    const { admin, update } = mockAdmin({ findBySub: null })
    const result = await handleStripeEvent(admin, {
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_foreign' } },
    } as unknown as Stripe.Event)
    expect(result.handled).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('marks canceled on customer.subscription.deleted', async () => {
    const { admin, update } = mockAdmin({ updateCount: 1 })
    const result = await handleStripeEvent(admin, {
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_1',
          status: 'canceled',
          customer: 'cus_1',
          current_period_end: 1_800_000_000,
          metadata: {
            app: SEORANKO_STRIPE_APP,
            seoranko_user_id: 'user-abc',
            seoranko_plan_id: 'seoranko_starter',
          },
        },
      },
    } as unknown as Stripe.Event)

    expect(result.handled).toBe(true)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled' })
    )
  })
})

describe('plans config', () => {
  it('resolves placeholder price from env', async () => {
    const { resolvePlanPriceId } = await import('./plans')
    const prev = process.env.STRIPE_PLACEHOLDER_PRICE_ID
    process.env.STRIPE_PLACEHOLDER_PRICE_ID = 'price_test_123'
    expect(resolvePlanPriceId('seoranko_starter')).toBe('price_test_123')
    process.env.STRIPE_PLACEHOLDER_PRICE_ID = prev
  })
})

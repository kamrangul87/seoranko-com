import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  getAppOrigin,
  getStripe,
  seorankoCustomerMetadata,
  seorankoSubscriptionMetadata,
} from '@/lib/stripe/client'
import {
  DEFAULT_SEORANKO_PLAN_ID,
  getSeorankoPlan,
  resolvePlanPriceId,
  SEORANKO_STRIPE_APP,
  type SeorankoPlanId,
} from '@/lib/stripe/plans'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

/**
 * POST /api/billing/checkout
 * Creates a Stripe Checkout Session (subscription mode) for the logged-in user.
 * Body: { planId?: 'seoranko_starter' }
 */
export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
    )
    const {
      data: { user },
    } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const planId = (
      typeof body.planId === 'string' ? body.planId : DEFAULT_SEORANKO_PLAN_ID
    ) as SeorankoPlanId
    const plan = getSeorankoPlan(planId)
    const priceId = resolvePlanPriceId(plan.id)

    const stripe = getStripe()
    const origin = getAppOrigin(req.url)
    const admin = createServiceRoleClient()

    const { data: existing } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle()

    let customerId = existing?.stripe_customer_id || null

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        metadata: seorankoCustomerMetadata(user.id),
        name: (user.user_metadata?.name as string | undefined) || undefined,
      })
      customerId = customer.id
    } else {
      await stripe.customers.update(customerId, {
        metadata: seorankoCustomerMetadata(user.id),
      })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard/billing?checkout=success`,
      cancel_url: `${origin}/dashboard/billing?checkout=cancel`,
      allow_promotion_codes: true,
      metadata: {
        app: SEORANKO_STRIPE_APP,
        seoranko_user_id: user.id,
        seoranko_plan_id: plan.id,
      },
      subscription_data: {
        metadata: seorankoSubscriptionMetadata(user.id, plan.id),
      },
    })

    if (!session.url) {
      return NextResponse.json({ error: 'Checkout session missing URL' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      url: session.url,
      sessionId: session.id,
      planId: plan.id,
    })
  } catch (err) {
    console.error('[billing/checkout]', err)
    const message = err instanceof Error ? err.message : 'Checkout failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

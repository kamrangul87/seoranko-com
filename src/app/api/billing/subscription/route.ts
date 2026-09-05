import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { DEFAULT_SEORANKO_PLAN_ID, getSeorankoPlan } from '@/lib/stripe/plans'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

/**
 * GET /api/billing/subscription
 * Returns the current user's SEORANKO subscription row (if any).
 * Prefer user-scoped RLS read; fall back to service role filtered by auth.uid.
 */
export async function GET() {
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

    let subscription = null
    const { data, error } = await authClient
      .from('subscriptions')
      .select(
        'id, plan_id, status, stripe_customer_id, stripe_subscription_id, current_period_end, created_at, updated_at',
      )
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      console.warn('[billing/subscription] anon read', error.message)
      const admin = createServiceRoleClient()
      const { data: adminData, error: adminError } = await admin
        .from('subscriptions')
        .select(
          'id, plan_id, status, stripe_customer_id, stripe_subscription_id, current_period_end, created_at, updated_at',
        )
        .eq('user_id', user.id)
        .maybeSingle()
      if (adminError) {
        return NextResponse.json({ error: adminError.message }, { status: 500 })
      }
      subscription = adminData
    } else {
      subscription = data
    }

    const plan = getSeorankoPlan(subscription?.plan_id || DEFAULT_SEORANKO_PLAN_ID)

    return NextResponse.json({
      ok: true,
      subscription,
      plan: {
        planId: plan.id,
        label: plan.label,
        description: plan.description,
      },
    })
  } catch (err) {
    console.error('[billing/subscription]', err)
    return NextResponse.json({ error: 'Failed to load subscription' }, { status: 500 })
  }
}

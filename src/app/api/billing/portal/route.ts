import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getAppOrigin, getStripe } from '@/lib/stripe/client'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

/**
 * POST /api/billing/portal
 * Opens Stripe Customer Portal for the logged-in user's stripe_customer_id.
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

    const admin = createServiceRoleClient()
    const { data: sub, error } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      console.error('[billing/portal] lookup', error.message)
      return NextResponse.json({ error: 'Could not load subscription' }, { status: 500 })
    }

    if (!sub?.stripe_customer_id) {
      return NextResponse.json(
        { error: 'No Stripe customer on file — subscribe first.' },
        { status: 400 },
      )
    }

    const stripe = getStripe()
    const origin = getAppOrigin(req.url)
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${origin}/dashboard/billing`,
    })

    return NextResponse.json({ ok: true, url: portal.url })
  } catch (err) {
    console.error('[billing/portal]', err)
    const message = err instanceof Error ? err.message : 'Portal session failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

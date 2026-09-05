import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/client'
import { handleStripeEvent } from '@/lib/stripe/webhook-handlers'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const runtime = 'nodejs'

/**
 * POST /api/webhooks/stripe
 *
 * SEORANKO-only webhook. Point a dedicated Stripe Dashboard endpoint at this
 * URL (do not share it with other products on the same Stripe account).
 * Events without SEORANKO metadata / known subscription ids are ignored
 * with HTTP 200 so Stripe does not retry unrelated product traffic.
 *
 * Requires STRIPE_WEBHOOK_SECRET (signing secret from Dashboard → Webhooks).
 */
export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!webhookSecret) {
    console.error('[webhooks/stripe] STRIPE_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  const rawBody = await req.text()

  let event
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature'
    console.error('[webhooks/stripe] signature', message)
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 },
    )
  }

  try {
    const result = await handleStripeEvent(createServiceRoleClient(), event)

    if (!result.handled) {
      console.info('[webhooks/stripe] skipped', event.type, result.reason)
    } else {
      console.info('[webhooks/stripe] handled', event.type)
    }

    return NextResponse.json({ received: true, type: event.type, ...result })
  } catch (err) {
    console.error('[webhooks/stripe] handler error', event.type, err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}

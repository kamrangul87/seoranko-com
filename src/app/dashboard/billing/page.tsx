'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { DashboardNav } from '@/components/DashboardNav'
import {
  DEFAULT_SEORANKO_PLAN_ID,
  getSeorankoPlan,
  hasManageableSubscription,
  type SeorankoPlanId,
} from '@/lib/stripe/plans'

interface SubscriptionRow {
  id: string
  plan_id: string
  status: string
  stripe_customer_id: string
  stripe_subscription_id: string
  current_period_end: string | null
  created_at: string
  updated_at: string
}

function statusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Active'
    case 'trialing':
      return 'Trial'
    case 'past_due':
      return 'Past due'
    case 'canceled':
      return 'Canceled'
    case 'unpaid':
      return 'Unpaid'
    case 'incomplete':
      return 'Incomplete'
    default:
      return status
  }
}

function statusTone(status: string): string {
  if (status === 'active' || status === 'trialing') {
    return 'bg-green-50 text-green-800 border-green-200'
  }
  if (status === 'past_due' || status === 'unpaid') {
    return 'bg-amber-50 text-amber-900 border-amber-200'
  }
  if (status === 'canceled') {
    return 'bg-[#F5F5F5] text-[#6B6B6B] border-[#E5E5E5]'
  }
  return 'bg-[#FAFAFA] text-[#0F0F0F] border-[#E5E5E5]'
}

function BillingContent() {
  const searchParams = useSearchParams()
  const checkoutState = searchParams.get('checkout')

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null)
  const [planMeta, setPlanMeta] = useState(() => getSeorankoPlan(DEFAULT_SEORANKO_PLAN_ID))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/subscription')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load billing')
      setSubscription(json.subscription || null)
      if (json.plan?.planId) {
        setPlanMeta(getSeorankoPlan(json.plan.planId as SeorankoPlanId))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function startCheckout() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: planMeta.id }),
      })
      const json = await res.json()
      if (!res.ok || !json.url) throw new Error(json.error || 'Could not start checkout')
      window.location.href = json.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
      setBusy(false)
    }
  }

  async function openPortal() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || !json.url) throw new Error(json.error || 'Could not open billing portal')
      window.location.href = json.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Portal failed')
      setBusy(false)
    }
  }

  const manageable = hasManageableSubscription(subscription?.status)
  const periodEnd = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null

  return (
    <div className="max-w-2xl mx-auto px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-[#6B6B6B] mt-1">
          Manage your SEORANKO subscription. Pricing is a placeholder until plans are finalized —
          changing the Stripe Price ID is a config update, not a code change.
        </p>
      </div>

      {checkoutState === 'success' && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          Payment received. If your plan status hasn&apos;t updated yet, wait a few seconds and
          refresh — the Stripe webhook syncs this page.
          <button type="button" onClick={() => void load()} className="ml-2 underline font-medium">
            Refresh now
          </button>
        </div>
      )}
      {checkoutState === 'cancel' && (
        <div className="rounded-xl border border-[#E5E5E5] bg-white px-4 py-3 text-sm text-[#6B6B6B]">
          Checkout canceled — no charge was made.
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-[#E5E5E5] bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-[#9B9B9B] uppercase tracking-wide">
              Current plan
            </div>
            <h2 className="text-xl font-semibold mt-1">{manageable ? planMeta.label : 'Free'}</h2>
            <p className="text-sm text-[#6B6B6B] mt-1">
              {manageable ? planMeta.description : 'No paid SEORANKO subscription yet.'}
            </p>
          </div>
          {subscription && (
            <span
              className={`text-xs px-2.5 py-1 rounded-full border ${statusTone(subscription.status)}`}
            >
              {statusLabel(subscription.status)}
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-[#9B9B9B]">Loading subscription…</p>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-[#9B9B9B]">Plan id</dt>
              <dd className="font-mono text-xs mt-0.5">{subscription?.plan_id || '—'}</dd>
            </div>
            <div>
              <dt className="text-[#9B9B9B]">Current period ends</dt>
              <dd className="mt-0.5">{periodEnd || '—'}</dd>
            </div>
          </dl>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          {!manageable ? (
            <button
              type="button"
              onClick={() => void startCheckout()}
              disabled={busy || loading}
              className="px-4 py-2 rounded-lg bg-[#FF6B2C] text-white text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'Redirecting…' : `Subscribe — ${planMeta.label}`}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void openPortal()}
              disabled={busy || loading}
              className="px-4 py-2 rounded-lg bg-[#0F0F0F] text-white text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'Opening…' : 'Manage billing'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || busy}
            className="px-4 py-2 rounded-lg border border-[#E5E5E5] bg-white text-sm disabled:opacity-50"
          >
            Refresh status
          </button>
        </div>
      </section>

      <p className="text-xs text-[#9B9B9B]">
        Test mode: use Stripe card <span className="font-mono">4242 4242 4242 4242</span> with any
        future expiry and any CVC. Webhook sync requires{' '}
        <span className="font-mono">STRIPE_WEBHOOK_SECRET</span> and a Dashboard endpoint pointed at{' '}
        <span className="font-mono">/api/webhooks/stripe</span>.
      </p>
    </div>
  )
}

export default function BillingPage() {
  return (
    <div
      className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden"
      style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}
    >
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <Suspense
          fallback={
            <div className="max-w-2xl mx-auto px-8 py-8 text-sm text-[#9B9B9B]">Loading billing…</div>
          }
        >
          <BillingContent />
        </Suspense>
      </main>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export type OnboardingStepId =
  | 'site'
  | 'github'
  | 'gsc'
  | 'crawl'
  | 'finding'
  | 'verified'

type Step = {
  id: OnboardingStepId
  label: string
  href: string
  done: boolean
  detail?: string
}

type ApiPayload = {
  ok: boolean
  steps: Step[]
  complete: boolean
}

/**
 * Beta onboarding checklist — Sites / GitHub / GSC / crawl / finding / verified fix.
 * Honest: unchecked until stored evidence exists.
 */
export function BetaOnboardingChecklist({ compact }: { compact?: boolean }) {
  const [payload, setPayload] = useState<ApiPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/beta/onboarding-status')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not load checklist')
        if (!cancelled) setPayload(data as ApiPayload)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Checklist unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-3 text-xs text-[#6B6B6B]">
        Onboarding checklist unavailable: {error}
      </div>
    )
  }

  if (!payload) {
    return (
      <div className="rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-3">
        <div className="h-3 w-40 bg-[#F5F4F1] rounded animate-pulse mb-2" />
        <div className="h-2 w-full bg-[#F5F4F1] rounded animate-pulse" />
      </div>
    )
  }

  if (payload.complete && compact) return null

  return (
    <div
      className={`rounded-[10px] border border-[#E8E8E4] bg-white ${compact ? 'px-4 py-3' : 'px-5 py-4'}`}
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#9B9B9B]">
            Beta setup
          </p>
          <p className="text-sm font-semibold text-[#0F0F0F] mt-0.5">
            Connect → crawl → approve fix → verify live
          </p>
        </div>
        <p className="text-xs text-[#6B6B6B] tabular-nums">
          {payload.steps.filter((s) => s.done).length}/{payload.steps.length}
        </p>
      </div>
      <ul className="space-y-2">
        {payload.steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2.5 text-sm">
            <span
              className={`mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                step.done ? 'bg-[#0F0F0F] text-white' : 'border border-[#D0D0CC] text-transparent'
              }`}
              aria-hidden
            >
              {step.done ? '✓' : '·'}
            </span>
            <div className="min-w-0 flex-1">
              <Link
                href={step.href}
                className={`font-medium ${step.done ? 'text-[#6B6B6B]' : 'text-[#0F0F0F] hover:text-[#FF6B2C]'}`}
              >
                {step.label}
              </Link>
              {step.detail && (
                <p className="text-[11px] text-[#9B9B9B] mt-0.5 leading-snug">{step.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

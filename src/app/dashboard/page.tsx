'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { DashboardNav } from '@/components/DashboardNav'
import { DASHBOARD_OVERVIEW_COPY } from '@/lib/dashboard-overview-copy'

type StepId = 'site' | 'github' | 'gsc' | 'crawl' | 'finding' | 'verified'

type OnboardingStep = {
  id: StepId
  label: string
  href: string
  done: boolean
  detail?: string
  actionLabel?: string
}

type CrawlSummary = {
  lastCrawlAt: string | null
  openFindings: {
    actionable: number
    informational: number
    internal: number
  }
}

type OnboardingPayload = {
  ok?: boolean
  steps?: OnboardingStep[]
  crawlSummary?: CrawlSummary | null
}

function formatCrawlDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [stepsKnown, setStepsKnown] = useState(false)
  const [doneById, setDoneById] = useState<Partial<Record<StepId, boolean>>>({})
  const [crawlSummary, setCrawlSummary] = useState<CrawlSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/beta/onboarding-status')
        if (!res.ok) {
          // Cannot determine state — show steps without status rather than guessing
          if (!cancelled) {
            setStepsKnown(false)
            setCrawlSummary(null)
          }
          return
        }
        const json = (await res.json()) as OnboardingPayload
        if (cancelled) return
        const map: Partial<Record<StepId, boolean>> = {}
        for (const s of json.steps || []) {
          map[s.id] = s.done
        }
        setDoneById(map)
        setStepsKnown(true)
        setCrawlSummary(json.crawlSummary ?? null)
      } catch {
        if (!cancelled) {
          setStepsKnown(false)
          setCrawlSummary(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const copy = DASHBOARD_OVERVIEW_COPY

  return (
    <div
      className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden"
      style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}
    >
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-12">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#0F0F0F] mb-2">{copy.title}</h1>
            <p className="text-[#6B6B6B] text-sm">{copy.lead}</p>
          </div>

          <div className="bg-white border border-[#E8E8E4] rounded-[12px] overflow-hidden mb-8">
            {copy.steps.map((step, i) => {
              const done = stepsKnown ? doneById[step.id as StepId] : undefined
              const statusKnown = typeof done === 'boolean'
              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-4 px-5 py-4 ${
                    i < copy.steps.length - 1 ? 'border-b border-[#F5F4F1]' : ''
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-semibold ${
                      statusKnown && done
                        ? 'bg-green-100 text-green-700'
                        : 'bg-[#F5F4F1] text-[#6B6B6B]'
                    }`}
                    aria-hidden
                  >
                    {statusKnown && done ? '✓' : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#0F0F0F]">
                      {step.label}
                      {'optional' in step && step.optional ? (
                        <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-[#9B9B9B]">
                          {copy.optionalSuffix}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-[#6B6B6B] mt-0.5">{step.detail}</p>
                    {loading ? (
                      <p className="text-[10px] text-[#9B9B9B] mt-1">…</p>
                    ) : statusKnown ? (
                      <p
                        className={`text-[10px] font-medium mt-1 ${
                          done ? 'text-green-700' : 'text-[#9B9B9B]'
                        }`}
                      >
                        {done ? copy.doneLabel : copy.notDoneLabel}
                      </p>
                    ) : null}
                  </div>
                  <Link
                    href={step.href}
                    className="flex-shrink-0 px-3 py-2 text-xs font-medium rounded-[8px] bg-[#FF6B2C] hover:bg-[#E85A1E] text-white transition-colors"
                  >
                    {step.actionLabel}
                  </Link>
                </div>
              )
            })}
          </div>

          {crawlSummary ? (
            <div className="bg-white border border-[#E8E8E4] rounded-[12px] p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#9B9B9B] mb-4">
                {copy.crawlSummaryTitle}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                {(
                  [
                    'actionable',
                    'informational',
                    'internal',
                  ] as const
                ).map((bucket) => (
                  <Link
                    key={bucket}
                    href="/dashboard/findings"
                    className="flex items-center justify-between px-3 py-2.5 rounded-[8px] border border-[#F5F4F1] hover:border-[#E8E8E4] hover:bg-[#FAFAF8] transition-colors"
                  >
                    <span className="text-xs text-[#6B6B6B]">
                      {copy.bucketLabels[bucket]}
                    </span>
                    <span className="text-sm font-semibold text-[#0F0F0F]">
                      {crawlSummary.openFindings[bucket]}
                    </span>
                  </Link>
                ))}
              </div>
              {formatCrawlDate(crawlSummary.lastCrawlAt) ? (
                <Link
                  href="/dashboard/findings"
                  className="text-xs text-[#6B6B6B] hover:text-[#FF6B2C] transition-colors"
                >
                  {copy.lastCrawlLabel}: {formatCrawlDate(crawlSummary.lastCrawlAt)} →
                </Link>
              ) : null}
              <p className="text-[10px] text-[#9B9B9B] mt-2">{copy.openFindingsLabel}</p>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  )
}

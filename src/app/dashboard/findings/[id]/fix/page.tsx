'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { DashboardNav } from '@/components/DashboardNav'
import {
  canOfferFix,
  type FixFlowState,
  type UiFinding,
} from '@/lib/fix-strategies/findings-ui/client'

const STEPS = ['approve', 'commit', 'verify'] as const

type UpgradePrompt = {
  title: string
  body: string
  benefits: string[]
  ctaLabel: string
  billingPath: string
}

export default function FindingFixFlowPage() {
  const params = useParams()
  const router = useRouter()
  const id = String(params?.id ?? '')
  const [finding, setFinding] = useState<UiFinding | null>(null)
  const [fixFlow, setFixFlow] = useState<FixFlowState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [upgrade, setUpgrade] = useState<UpgradePrompt | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      const res = await fetch(`/api/fix-strategies/findings/${id}`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const body = (await res.json()) as {
        finding: UiFinding
        fixFlow: FixFlowState
      }
      setFinding(body.finding)
      setFixFlow(body.fixFlow)
      if (!canOfferFix(body.finding.surfaceClass)) {
        router.replace(`/dashboard/findings/${id}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    }
  }, [id, router])

  useEffect(() => {
    void load()
  }, [load])

  async function run(action: 'approve' | 'commit' | 'verify') {
    setBusy(true)
    setError(null)
    setUpgrade(null)
    try {
      const res = await fetch(`/api/fix-strategies/findings/${id}/fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = (await res.json()) as {
        error?: string
        code?: string
        billingPath?: string
        upgrade?: {
          title: string
          body: string
          benefits: string[]
          ctaLabel: string
        }
        finding?: UiFinding
        fixFlow?: FixFlowState
      }
      if (!res.ok) {
        if (
          res.status === 402 &&
          body.code === 'SUBSCRIPTION_REQUIRED' &&
          body.upgrade
        ) {
          setUpgrade({
            ...body.upgrade,
            billingPath: body.billingPath || '/dashboard/billing',
          })
          return
        }
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      if (body.finding) setFinding(body.finding)
      if (body.fixFlow) setFixFlow(body.fixFlow)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const stepIndex =
    fixFlow?.step === 'verified'
      ? 3
      : fixFlow?.step === 'committed'
        ? 2
        : fixFlow?.step === 'approved'
          ? 1
          : 0

  return (
    <div
      className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden"
      style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}
    >
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <Link
            href={`/dashboard/findings/${id}`}
            className="text-sm text-[#6B6B6B] hover:text-[#0F0F0F]"
          >
            ← Finding
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight mt-4">
            Fix flow
          </h1>
          <p className="text-[#6B6B6B] mt-1">
            Approve → commit → verify against the live response. Detection and
            findings stay free — only committing a write requires a plan.
          </p>

          {upgrade && (
            <div className="mt-4 rounded-[10px] border border-[#FF6B2C]/30 bg-white px-4 py-4 text-sm">
              <p className="font-medium text-[#0F0F0F]">{upgrade.title}</p>
              <p className="mt-1 text-[#6B6B6B]">{upgrade.body}</p>
              <ul className="mt-3 list-disc pl-5 space-y-1 text-[#0F0F0F]">
                {upgrade.benefits.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <Link
                href={upgrade.billingPath}
                className="inline-block mt-4 px-4 py-2 rounded-md bg-[#FF6B2C] text-white text-sm font-medium hover:opacity-90"
              >
                {upgrade.ctaLabel}
              </Link>
            </div>
          )}

          {error && !upgrade && (
            <div className="mt-4 rounded-[10px] border border-red-100 bg-red-50 text-red-800 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {finding && (
            <div className="mt-6 space-y-6">
              <div className="rounded-[10px] border border-[#E8E8E4] bg-white p-5">
                <p className="font-mono text-sm">{finding.verdict}</p>
                {finding.proposedDiff && (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-[#6B6B6B]">
                      {finding.proposedDiff.summary}
                    </p>
                    {(finding.proposedDiff.before ||
                      finding.proposedDiff.after) && (
                      <div className="grid grid-cols-1 gap-2 text-xs font-mono">
                        {finding.proposedDiff.before && (
                          <pre className="rounded-md bg-red-50 border border-red-100 p-2 overflow-x-auto whitespace-pre-wrap">
                            − {finding.proposedDiff.before}
                          </pre>
                        )}
                        {finding.proposedDiff.after && (
                          <pre className="rounded-md bg-emerald-50 border border-emerald-100 p-2 overflow-x-auto whitespace-pre-wrap">
                            + {finding.proposedDiff.after}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <ol className="flex gap-2">
                {STEPS.map((label, i) => (
                  <li
                    key={label}
                    className={`flex-1 text-center text-xs py-2 rounded-md border ${
                      i < stepIndex
                        ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                        : i === stepIndex
                          ? 'bg-white border-[#FF6B2C] text-[#0F0F0F]'
                          : 'bg-[#F4F4F2] border-[#E8E8E4] text-[#9B9B9B]'
                    }`}
                  >
                    {i + 1}. {label}
                  </li>
                ))}
              </ol>

              <div className="rounded-[10px] border border-[#E8E8E4] bg-white p-5 space-y-4">
                <div>
                  <h2 className="text-sm font-medium">1. Approve</h2>
                  <p className="text-sm text-[#6B6B6B] mt-1">
                    Confirm the deterministic fix. Nothing is written yet.
                  </p>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      (fixFlow?.step !== 'idle' && fixFlow?.step !== 'failed')
                    }
                    onClick={() => void run('approve')}
                    className="mt-3 px-4 py-2 rounded-md bg-[#0F0F0F] text-white text-sm disabled:opacity-40"
                  >
                    Approve
                  </button>
                  {fixFlow?.approvedAt && (
                    <p className="text-xs text-[#9B9B9B] mt-2">
                      Approved {fixFlow.approvedAt}
                    </p>
                  )}
                </div>

                <div className="border-t border-[#E8E8E4] pt-4">
                  <h2 className="text-sm font-medium">2. Commit</h2>
                  <p className="text-sm text-[#6B6B6B] mt-1">
                    Open a pull request on the connected GitHub repo (never
                    pushes to main). Requires an active subscription.
                  </p>
                  <button
                    type="button"
                    disabled={busy || fixFlow?.step !== 'approved'}
                    onClick={() => void run('commit')}
                    className="mt-3 px-4 py-2 rounded-md bg-[#FF6B2C] text-white text-sm disabled:opacity-40"
                  >
                    Commit via PR
                  </button>
                  {fixFlow?.commitDetail && (
                    <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 mt-3">
                      {fixFlow.commitDetail}
                    </p>
                  )}
                  {fixFlow?.prUrl && (
                    <p className="text-sm mt-2">
                      <a
                        href={fixFlow.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#FF6B2C] hover:underline break-all"
                      >
                        {fixFlow.prUrl}
                      </a>
                    </p>
                  )}
                </div>

                <div className="border-t border-[#E8E8E4] pt-4">
                  <h2 className="text-sm font-medium">3. Verify</h2>
                  <p className="text-sm text-[#6B6B6B] mt-1">
                    Wait for the Vercel preview deploy, then run the topic
                    verify-live module against the preview URL.
                  </p>
                  <button
                    type="button"
                    disabled={busy || fixFlow?.step !== 'committed'}
                    onClick={() => void run('verify')}
                    className="mt-3 px-4 py-2 rounded-md border border-[#E8E8E4] bg-white text-sm disabled:opacity-40"
                  >
                    Verify live
                  </button>
                  {fixFlow?.previewUrl && (
                    <p className="text-xs text-[#9B9B9B] mt-2 break-all">
                      Preview: {fixFlow.previewUrl}
                    </p>
                  )}
                  {fixFlow?.verifyDetail && (
                    <p
                      className={`text-sm rounded-md px-3 py-2 mt-3 border ${
                        fixFlow.verifyOk
                          ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                          : 'bg-red-50 border-red-100 text-red-800'
                      }`}
                    >
                      {fixFlow.verifyDetail}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { DashboardNav } from '@/components/DashboardNav'
import { createClient } from '@/lib/supabase/client'

type Site = { id: string; domain: string; brand: string }

type WeeklyReport = {
  ok: boolean
  weekEnding: string | null
  weekStart?: string | null
  weekEnd?: string | null
  totals: {
    clicks: { current: number; previous: number; delta: number }
    impressions: { current: number; previous: number; delta: number }
  }
  wins: Array<{
    url: string
    query: string
    positionChange: number
    clicksDelta: number
    impressionsDelta: number
    week2: { clicks: number; impressions: number; avg_position: number }
    week1: { clicks: number; impressions: number; avg_position: number }
  }>
  nextAction: null | {
    url: string
    query: string
    avg_position: number
    ctr: number
    impressions?: number
    suggestedFix: 'title_meta' | 'internal_links' | 'content_gaps' | 'schema'
  }
  receipts: Array<{
    itemId: string
    pageUrl: string | null
    verdict: string
    title?: string
    plainEnglish?: string
    alsoPrNumbers?: number[]
    prUrl: string | null
    prNumber: number | null
    productionVerifiedAt: string | null
    previewVerifiedAt: string | null
    createdAt: string
    beforeAfter: null | {
      baseline: { impressions: number; clicks: number; avg_position: number | null }
      observation: { impressions: number; clicks: number; avg_position: number | null }
      missingObservationDays: number
      totalObservationDays: number
      requiredObservationDays: number
    }
  }>
}

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F]">
          <DashboardNav />
          <main className="flex-1 p-8 text-sm text-[#9B9B9B]">Loading…</main>
        </div>
      }
    >
      <ReportsPageInner />
    </Suspense>
  )
}

function ReportsPageInner() {
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState('')
  const [report, setReport] = useState<WeeklyReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reloadSites = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return [] as Site[]
    const { data } = await supabase
      .from('connected_sites')
      .select('id, domain, brand')
      .eq('user_id', user.id)
      .order('is_primary', { ascending: false })
    const list = (data || []) as Site[]
    setSites(list)
    return list
  }, [])

  useEffect(() => {
    void (async () => {
      const list = await reloadSites()
      const initial = list[0]?.id || ''
      setSiteId(initial)
    })()
  }, [reloadSites])

  useEffect(() => {
    if (!siteId) return
    setLoading(true)
    setError(null)
    setReport(null)
    void (async () => {
      try {
        const res = await fetch(`/api/reports/weekly?siteId=${encodeURIComponent(siteId)}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not load report')
        setReport(data as WeeklyReport)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed')
      } finally {
        setLoading(false)
      }
    })()
  }, [siteId])

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold mb-1">Weekly report</h1>
              <p className="text-[#6B6B6B]">
                Honest progress and the next best action — based on finalized Search Console data.
              </p>
            </div>
            <div>
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="border border-[#E5E5E5] rounded-lg px-3 py-1.5 bg-white"
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.domain}</option>
                ))}
              </select>
            </div>
          </div>

          {loading ? <p className="text-sm text-[#6B6B6B]">Loading…</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          {report && (
            <div className="space-y-6">
              <div className="border border-[#E5E5E5] rounded-lg px-4 py-4 bg-white">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="font-medium">This week</h2>
                    <p className="text-sm text-[#6B6B6B]">
                      {report.weekStart && report.weekEnd
                        ? `${report.weekStart} → ${report.weekEnd}`
                        : report.weekEnding
                          ? `Week ending ${report.weekEnding}`
                          : 'No finalized week yet'}
                      {' '}
                      — finalized GSC only
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <div className="text-center">
                      <div className="text-[22px] font-semibold text-[#0F0F0F]">{report.totals.clicks.current.toLocaleString()}</div>
                      <div className="text-xs text-[#6B6B6B]">Clicks ({report.totals.clicks.delta >= 0 ? '+' : ''}{report.totals.clicks.delta})</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[22px] font-semibold text-[#0F0F0F]">{report.totals.impressions.current.toLocaleString()}</div>
                      <div className="text-xs text-[#6B6B6B]">Impr. ({report.totals.impressions.delta >= 0 ? '+' : ''}{report.totals.impressions.delta})</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border border-[#E5E5E5] rounded-lg px-4 py-4 bg-white">
                <h3 className="font-medium">Wins</h3>
                {report.wins.length === 0 ? (
                  <p className="text-sm text-[#6B6B6B]">No clear week‑over‑week improvements yet.</p>
                ) : (
                  <ul className="list-disc pl-5 text-sm space-y-1">
                    {report.wins.slice(0, 8).map((w, i) => (
                      <li key={i}>
                        <span className="text-[#0F0F0F]">{w.query}</span>{' '}
                        <span className="text-[#6B6B6B]">on</span>{' '}
                        <span className="break-all">{w.url}</span>{' '}
                        <span className="text-[#0F0F0F]">pos {w.week1.avg_position.toFixed(1)} → {w.week2.avg_position.toFixed(1)}</span>{' '}
                        <span className={w.clicksDelta >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                          ({w.clicksDelta >= 0 ? '+' : ''}{w.clicksDelta} clicks)
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="border border-[#E5E5E5] rounded-lg px-4 py-4 bg-white">
                <h3 className="font-medium">Best next action</h3>
                {!report.nextAction ? (
                  <p className="text-sm text-[#6B6B6B]">No clear Page‑2 opportunity in the 28‑day window.</p>
                ) : (
                  <div className="text-sm">
                    <div>
                      Target: <span className="break-all">{report.nextAction.url}</span>
                    </div>
                    <div>Query: <span className="text-[#0F0F0F]">{report.nextAction.query}</span></div>
                    <div>
                      Position: {report.nextAction.avg_position.toFixed(1)}
                      {report.nextAction.impressions != null
                        ? ` · ${report.nextAction.impressions} impr.`
                        : ''}
                      {' · CTR '}
                      {(report.nextAction.ctr * 100).toFixed(1)}%
                    </div>
                    <div className="mt-1">
                      Suggested fix: <span className="font-medium text-[#0F0F0F]">
                        {report.nextAction.suggestedFix === 'title_meta' ? 'Improve title and meta description'
                          : report.nextAction.suggestedFix === 'internal_links' ? 'Add internal links from related pages'
                          : report.nextAction.suggestedFix === 'content_gaps' ? 'Cover missing subtopics / FAQ'
                          : 'Add schema'}
                      </span>
                    </div>
                    <div className="mt-2">
                      <a
                        className="text-xs underline text-[#FF6B2C]"
                        href={`/dashboard/experiments?siteId=${encodeURIComponent(siteId)}&focus=${encodeURIComponent(report.nextAction.url)}#page2-opportunities`}
                      >
                        Open suggestion on Google status
                      </a>
                    </div>
                  </div>
                )}
                <p className="text-xs text-[#9B9B9B] mt-2">Guidance only — no ranking promises.</p>
              </div>

              <div className="border border-[#E5E5E5] rounded-lg px-4 py-4 bg-white">
                <h3 className="font-medium">Fixes shipped this week</h3>
                {report.receipts.length === 0 ? (
                  <p className="text-sm text-[#6B6B6B]">No fixes verified live this week.</p>
                ) : (
                  <ul className="list-disc pl-5 text-sm space-y-2">
                    {report.receipts.map((r) => {
                      const applied = r.productionVerifiedAt || r.previewVerifiedAt || r.createdAt
                      const ba = r.beforeAfter
                      const ready = ba && ba.missingObservationDays === 0
                      return (
                        <li key={r.itemId}>
                          <div className="break-all">
                            <span className="text-[#0F0F0F]">
                              {r.title || r.plainEnglish || r.verdict.replace(/_/g, ' ')}
                            </span>{' '}
                            on <span className="break-all">{r.pageUrl || '—'}</span>{' '}
                            {r.prUrl ? (<a className="underline text-[#6B6B6B]" href={r.prUrl} target="_blank" rel="noreferrer">PR {r.prNumber ?? ''}</a>) : null}
                            {r.alsoPrNumbers && r.alsoPrNumbers.length > 0
                              ? ` (also PR #${r.alsoPrNumbers.join(', #')})`
                              : ''}
                          </div>
                          <div className="text-[#6B6B6B]">Applied: {new Date(applied).toLocaleDateString()}</div>
                          {ba ? (
                            <div className="text-xs mt-1">
                              {ready ? (
                                <span>
                                  28‑day before/after: clicks {ba.baseline.clicks} → {ba.observation.clicks}, impressions {ba.baseline.impressions} → {ba.observation.impressions}, position {ba.baseline.avg_position?.toFixed(1) ?? '—'} → {ba.observation.avg_position?.toFixed(1) ?? '—'}
                                </span>
                              ) : (
                                <span>Before/after observation window incomplete — check back later.</span>
                              )}
                            </div>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <div className="text-xs text-[#9B9B9B]">
                Plain, honest wording — this report suggests next steps but never promises rankings.
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}


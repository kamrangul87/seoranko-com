'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { DashboardNav } from '@/components/DashboardNav'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

interface Site {
  id: string
  domain: string
  brand: string
}

interface GscConnection {
  id: string
  property_url: string | null
  status: string
  connected_at: string
  last_sync_at: string | null
  last_error: string | null
}

interface Readiness {
  passed: boolean
  reason_code: string
  reasonLabel: string
  evidence: {
    baselineStart?: string | null
    baselineEnd?: string | null
    usableDayCount?: number
    minDaysRequired?: number
    urlCountWithImpressions?: number
    minUrlsRequired?: number
    candidateUrlCount?: number
    zeroImpressionUrlCount?: number
    zeroImpressionRatio?: number
    totalImpressions?: number
    medianAvgPosition?: number | null
    discontinuity?: {
      dropDate: string
      previousDate: string
      previousImpressions: number
      dropImpressions: number
      dropRatio: number
    } | null
  }
  checked_at: string | null
  persisted?: boolean
}

interface MetricsSummary {
  urlCount: number
  dayCount: number
  totalImpressions: number
  totalClicks: number
  medianAvgPosition: number | null
  baselineStart: string | null
  baselineEnd: string | null
  provisionalRowCount: number
}

interface GscProperty {
  siteUrl: string
  permissionLevel: string
}

export default function ExperimentsPage() {
  return (
    <Suspense
      fallback={
        <div
          className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F]"
          style={{ fontFamily: "'Outfit', sans-serif" }}
        >
          <DashboardNav />
          <main className="flex-1 p-8 text-sm text-[#9B9B9B]">Loading…</main>
        </div>
      }
    >
      <ExperimentsPageInner />
    </Suspense>
  )
}

function ExperimentsPageInner() {
  const searchParams = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState('')
  const [connection, setConnection] = useState<GscConnection | null>(null)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [metricsSummary, setMetricsSummary] = useState<MetricsSummary | null>(null)
  const [properties, setProperties] = useState<GscProperty[]>([])
  const [pickingProperty, setPickingProperty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const loadStatus = useCallback(async (id: string) => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/experiments/status?siteId=${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load status')
      setConnection(data.connection || null)
      setReadiness(data.readiness || null)
      setMetricsSummary(data.metricsSummary || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }: { data: { user: User | null } }) => {
      if (!user) return
      const { data } = await supabase
        .from('connected_sites')
        .select('id, domain, brand')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })
      const list = (data || []) as Site[]
      setSites(list)
      const fromQuery = searchParams.get('siteId') || ''
      const initial = fromQuery && list.some((s) => s.id === fromQuery) ? fromQuery : list[0]?.id || ''
      setSiteId(initial)
    })
  }, [searchParams])

  useEffect(() => {
    if (siteId) void loadStatus(siteId)
  }, [siteId, loadStatus])

  useEffect(() => {
    const gscError = searchParams.get('gsc_error')
    if (gscError) setError(gscError)
    if (searchParams.get('gsc') === 'pick_property' && siteId) {
      setPickingProperty(true)
      void (async () => {
        try {
          const res = await fetch(`/api/gsc/properties?siteId=${encodeURIComponent(siteId)}`)
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Could not list properties')
          setProperties(data.properties || [])
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not list properties')
        }
      })()
    }
  }, [searchParams, siteId])

  async function startConnect() {
    if (!siteId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/gsc/connect?siteId=${encodeURIComponent(siteId)}&action=connect`,
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not start Google connection')
      window.location.href = data.authorizeUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect failed')
      setBusy(false)
    }
  }

  async function selectProperty(propertyUrl: string) {
    if (!siteId || !propertyUrl) return
    setBusy(true)
    setError(null)
    setMessage('Saving property and backfilling Search Console history… this can take a minute.')
    try {
      const res = await fetch('/api/gsc/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, propertyUrl }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Could not save property')
      }
      setPickingProperty(false)
      setMessage(
        data.sync?.error
          ? `Property saved, but sync reported: ${data.sync.error}`
          : `Backfill complete — ${data.sync?.rowsUpserted ?? 0} daily URL rows upserted.`,
      )
      await loadStatus(siteId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Property save failed')
    } finally {
      setBusy(false)
    }
  }

  async function runSync(action: 'sync' | 'backfill' | 'recheck') {
    if (!siteId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/experiments/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Action failed')
      if (data.sync?.error) setError(data.sync.error)
      else setMessage(action === 'recheck' ? 'Readiness rechecked.' : 'Sync finished.')
      await loadStatus(siteId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const connected = !!(connection && connection.status !== 'revoked')
  const hasProperty = !!(connection?.property_url)
  const statusLabel =
    connection?.status === 'active'
      ? 'Connected'
      : connection?.status === 'expired'
        ? 'Expired — reconnect'
        : connection?.status === 'revoked'
          ? 'Revoked'
          : 'Not connected'

  return (
    <div
      className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden"
      style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}
    >
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8 space-y-6">
          <div>
            <h1 className="text-2xl font-semibold mb-2">Experiments</h1>
            <p className="text-[#6B6B6B]">
              Measure which site fixes actually move Search Console outcomes — and which do nothing.
              Measurement windows are weeks, not days: only a small share of pages reach the top 10
              within a year, so short windows will look flat even when the method is working.
            </p>
          </div>

          {sites.length === 0 ? (
            <div className="border border-[#E5E5E5] rounded-lg px-4 py-3 bg-white text-sm">
              Add a site in Settings → Your Sites before connecting Search Console.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 items-center">
              <label className="text-sm text-[#6B6B6B]">Site</label>
              <select
                className="border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white"
                value={siteId}
                onChange={(e) => {
                  setSiteId(e.target.value)
                  setPickingProperty(false)
                  setMessage(null)
                  setError(null)
                }}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.domain}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <div className="border border-red-200 bg-red-50 text-red-900 rounded-lg px-3 py-2 text-sm">
              {error}
            </div>
          )}
          {message && (
            <div className="border border-sky-200 bg-sky-50 text-sky-900 rounded-lg px-3 py-2 text-sm">
              {message}
            </div>
          )}

          {loading && <p className="text-sm text-[#6B6B6B]">Loading…</p>}

          {!loading && siteId && !connected && (
            <div className="border border-[#E5E5E5] rounded-lg px-4 py-4 bg-white space-y-3">
              <h2 className="font-medium">Connect Google Search Console</h2>
              <p className="text-sm text-[#6B6B6B]">
                Connecting lets SEORANKO read per-URL clicks, impressions, CTR, and average position
                so we can establish a baseline before any experiment. We request read-only access
                (`webmasters.readonly`) — no write permission to your listings.
              </p>
              <p className="text-sm text-[#6B6B6B]">
                You must be a verified owner of the Search Console property for this domain. If you
                are not, Google will deny access and we will show that explicitly.
              </p>
              <button
                type="button"
                disabled={busy || !siteId}
                onClick={() => void startConnect()}
                className="px-4 py-2 rounded-lg bg-[#0F0F0F] text-white disabled:opacity-50"
              >
                {busy ? 'Redirecting…' : 'Connect Google Search Console'}
              </button>
            </div>
          )}

          {!loading && connected && (pickingProperty || !hasProperty) && (
            <div className="border border-[#E5E5E5] rounded-lg px-4 py-4 bg-white space-y-3">
              <h2 className="font-medium">Choose a Search Console property</h2>
              <p className="text-sm text-[#6B6B6B]">
                Status: {statusLabel}. Pick the property that matches this site. On save we backfill
                available history (~16 months) — that backfill is the baseline window.
              </p>
              {properties.length === 0 ? (
                <button
                  type="button"
                  disabled={busy}
                  className="text-sm underline"
                  onClick={() => {
                    setPickingProperty(true)
                    void (async () => {
                      const res = await fetch(`/api/gsc/properties?siteId=${encodeURIComponent(siteId)}`)
                      const data = await res.json()
                      if (!res.ok) setError(data.error || 'Could not list properties')
                      else setProperties(data.properties || [])
                    })()
                  }}
                >
                  Load properties
                </button>
              ) : (
                <ul className="space-y-2">
                  {properties.map((p) => (
                    <li key={p.siteUrl}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void selectProperty(p.siteUrl)}
                        className="w-full text-left border border-[#E5E5E5] rounded-lg px-3 py-2 hover:bg-[#FAFAF8] disabled:opacity-50"
                      >
                        <div className="font-medium text-sm">{p.siteUrl}</div>
                        <div className="text-xs text-[#6B6B6B]">{p.permissionLevel}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {connection?.status === 'expired' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startConnect()}
                  className="text-sm underline"
                >
                  Reconnect Google account
                </button>
              )}
            </div>
          )}

          {!loading && connected && hasProperty && (
            <div className="space-y-4">
              <div className="border border-[#E5E5E5] rounded-lg px-4 py-4 bg-white space-y-2">
                <div className="flex flex-wrap justify-between gap-2 items-start">
                  <div>
                    <h2 className="font-medium">Search Console</h2>
                    <p className="text-sm text-[#6B6B6B]">
                      {statusLabel} · {connection?.property_url}
                    </p>
                    {connection?.last_sync_at && (
                      <p className="text-xs text-[#9B9B9B]">
                        Last sync {new Date(connection.last_sync_at).toLocaleString()}
                      </p>
                    )}
                    {connection?.last_error && (
                      <p className="text-sm text-red-700 mt-1">Sync error: {connection.last_error}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runSync('sync')}
                      className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] bg-white text-sm disabled:opacity-50"
                    >
                      Sync now
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runSync('backfill')}
                      className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] bg-white text-sm disabled:opacity-50"
                    >
                      Full backfill
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runSync('recheck')}
                      className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] bg-white text-sm disabled:opacity-50"
                    >
                      Recheck readiness
                    </button>
                  </div>
                </div>
              </div>

              {readiness && !readiness.passed && (
                <div className="border border-amber-200 rounded-lg px-4 py-4 bg-amber-50 space-y-2">
                  <h2 className="font-medium text-amber-950">Baseline not ready</h2>
                  <p className="text-sm text-amber-900">{readiness.reasonLabel}</p>
                  <ul className="text-sm text-amber-900/90 space-y-1">
                    <li>
                      URLs with impressions: {readiness.evidence.urlCountWithImpressions ?? '—'} /{' '}
                      {readiness.evidence.minUrlsRequired ?? 30} required
                    </li>
                    <li>
                      Usable final days: {readiness.evidence.usableDayCount ?? '—'} /{' '}
                      {readiness.evidence.minDaysRequired ?? 56} required
                    </li>
                    <li>
                      Zero-impression URL ratio:{' '}
                      {typeof readiness.evidence.zeroImpressionRatio === 'number'
                        ? `${(readiness.evidence.zeroImpressionRatio * 100).toFixed(1)}%`
                        : '—'}{' '}
                      (max 40%)
                    </li>
                    <li>
                      Window: {readiness.evidence.baselineStart || '—'} →{' '}
                      {readiness.evidence.baselineEnd || '—'}
                    </li>
                    {readiness.evidence.discontinuity && (
                      <li>
                        Discontinuity on {readiness.evidence.discontinuity.dropDate}: impressions{' '}
                        {readiness.evidence.discontinuity.dropImpressions} after{' '}
                        {readiness.evidence.discontinuity.previousImpressions} (
                        {(readiness.evidence.discontinuity.dropRatio * 100).toFixed(0)}% of prior day)
                      </li>
                    )}
                  </ul>
                  <p className="text-xs text-amber-800">
                    Rank movement is slow — keep collecting weeks of clean baseline before starting an
                    experiment. Creating experiments lands in the next release.
                  </p>
                </div>
              )}

              {readiness?.passed && metricsSummary && (
                <div className="border border-green-200 rounded-lg px-4 py-4 bg-green-50 space-y-3">
                  <h2 className="font-medium text-green-950">Baseline ready</h2>
                  <div className="grid grid-cols-2 gap-3 text-sm text-green-950">
                    <div>
                      <div className="text-xs text-green-800">URLs</div>
                      <div className="font-medium">{metricsSummary.urlCount}</div>
                    </div>
                    <div>
                      <div className="text-xs text-green-800">Date range</div>
                      <div className="font-medium">
                        {metricsSummary.baselineStart} → {metricsSummary.baselineEnd}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-green-800">Total impressions</div>
                      <div className="font-medium">
                        {metricsSummary.totalImpressions.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-green-800">Median avg. position</div>
                      <div className="font-medium">
                        {metricsSummary.medianAvgPosition != null
                          ? metricsSummary.medianAvgPosition.toFixed(1)
                          : '—'}
                      </div>
                    </div>
                  </div>
                  {metricsSummary.provisionalRowCount > 0 && (
                    <p className="text-xs text-green-800">
                      {metricsSummary.provisionalRowCount} provisional row(s) in the GSC lag window
                      will be overwritten on later syncs.
                    </p>
                  )}
                  <button
                    type="button"
                    disabled
                    className="px-4 py-2 rounded-lg bg-[#0F0F0F]/40 text-white cursor-not-allowed"
                    title="Coming next"
                  >
                    Create experiment (coming next)
                  </button>
                  <p className="text-xs text-green-800">
                    Expect measurement windows measured in weeks. A flat 48-hour chart is normal — not
                    a product failure.
                  </p>
                </div>
              )}

              {!readiness && hasProperty && (
                <div className="border border-[#E5E5E5] rounded-lg px-4 py-3 bg-white text-sm text-[#6B6B6B]">
                  No readiness check stored yet. Run a sync or backfill to compute one.
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

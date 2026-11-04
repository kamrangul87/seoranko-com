'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { DashboardNav } from '@/components/DashboardNav'
import { createClient } from '@/lib/supabase/client'

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

interface GscAccount {
  id: string
  status: string
  connected_at: string
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

interface InterventionRow {
  id: string
  url_id: string
  intervention_type: string
  intervention_subtype: string
  interference_scope: string
  lifecycle_state: string
  applied_at: string | null
  verified_at: string | null
  experiment_id: string | null
  is_isolated: boolean
}

interface CausalResultRow {
  id: string
  intervention_id: string
  metric: string
  is_exploratory: boolean
  effect_estimate: number | null
  validity_status: string
  result_direction: string | null
  calculated_at: string
  treatment_n: number | null
  control_n: number | null
}

interface PipelineStatus {
  baseline: boolean
  intervention: boolean
  verified: boolean
  measuring: boolean
  result: boolean
}

interface GscProperty {
  siteUrl: string
  permissionLevel: string
  domain?: string | null
  alreadyTracked?: boolean
  siteExists?: boolean
  trackedSiteId?: string | null
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
  const [account, setAccount] = useState<GscAccount | null>(null)
  const [connection, setConnection] = useState<GscConnection | null>(null)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [metricsSummary, setMetricsSummary] = useState<MetricsSummary | null>(null)
  const [interventions, setInterventions] = useState<InterventionRow[]>([])
  const [causalResults, setCausalResults] = useState<CausalResultRow[]>([])
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null)
  const [properties, setProperties] = useState<GscProperty[]>([])
  const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set())
  const [pickingProperties, setPickingProperties] = useState(false)
  const [pickingProperty, setPickingProperty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [opportunities, setOpportunities] = useState<
    | {
        startDate: string
        endDate: string
        windowDays: number
        opportunities: Array<{
          url: string
          query: string
          clicks: number
          impressions: number
          ctr: number
          avg_position: number
          opportunity_score: number
          suggested_actions: string[]
        }>
      }
    | null
  >(null)
  const [suggestions, setSuggestions] = useState<Record<string, {
    currentTitle: string | null
    currentDescription: string | null
    suggestedTitle: string | null
    suggestedDescription: string | null
    targetedQueries: string[]
    loading?: boolean
    error?: string | null
  }>>({})
  const [weekly, setWeekly] = useState<null | {
    weekEnding: string
    totals: { clicks: { current: number; previous: number; delta: number }, impressions: { current: number; previous: number; delta: number } }
    wins: Array<{ url: string; query: string; positionChange: number; clicksDelta: number; week2: { avg_position: number } }>
    nextAction: null | { url: string; query: string; avg_position: number; ctr: number; suggestedFix: 'title_meta' | 'internal_links' | 'content_gaps' | 'schema' }
  }>(null)
  const [linkSuggestions, setLinkSuggestions] = useState<Record<string, {
    anchorText: string
    sources: Array<{ sourceUrl: string; insertion: 'related-list' }>
    loading?: boolean
    error?: string | null
  }>>({})
  const [contentGaps, setContentGaps] = useState<Record<string, {
    basis: 'serp' | 'queries-only'
    gaps: Array<{ gap: string; servesQueries: string[] }>
    notes: string[]
    loading?: boolean
    error?: string | null
  }>>({})

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

  const loadAccount = useCallback(async () => {
    const res = await fetch('/api/gsc/connect?action=status')
    const data = await res.json()
    if (res.ok) setAccount(data.account || null)
  }, [])

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
      setInterventions(data.interventions || [])
      setCausalResults(data.causalResults || [])
      setPipelineStatus(data.pipelineStatus || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadAccountProperties = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/gsc/properties')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not list properties')
      const list = (data.properties || []) as GscProperty[]
      setProperties(list)
      setSelectedProperties(
        new Set(list.filter((p) => !p.alreadyTracked).map((p) => p.siteUrl)),
      )
      setPickingProperties(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not list properties')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const list = await reloadSites()
      await loadAccount()
      const fromQuery = searchParams.get('siteId') || ''
      const initial = fromQuery && list.some((s) => s.id === fromQuery) ? fromQuery : list[0]?.id || ''
      setSiteId(initial)
    })()
  }, [searchParams, reloadSites, loadAccount])

  useEffect(() => {
    if (siteId) void loadStatus(siteId)
  }, [siteId, loadStatus])

  useEffect(() => {
    // Load weekly report (best‑effort; ignore failures)
    setWeekly(null)
    if (!siteId) return
    void (async () => {
      try {
        const res = await fetch(`/api/reports/weekly?siteId=${encodeURIComponent(siteId)}`)
        const data = await res.json()
        if (!res.ok) return
        setWeekly({
          weekEnding: data.weekEnding,
          totals: data.totals,
          wins: (data.wins || []).slice(0, 3),
          nextAction: data.nextAction || null,
        })
      } catch {
        // ignore
      }
    })()
  }, [siteId])

  useEffect(() => {
    setOpportunities(null)
    if (!siteId) return
    void (async () => {
      try {
        const res = await fetch(`/api/gsc/opportunities?siteId=${encodeURIComponent(siteId)}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not load opportunities')
        setOpportunities({
          startDate: data.startDate,
          endDate: data.endDate,
          windowDays: data.windowDays,
          opportunities: data.opportunities || [],
        })
      } catch {
        // Safe empty state on error (e.g. migration not applied yet)
        setOpportunities({
          startDate: '',
          endDate: '',
          windowDays: 0,
          opportunities: [],
        })
      }
    })()
  }, [siteId])

  useEffect(() => {
    const gscError = searchParams.get('gsc_error')
    if (gscError) setError(gscError)

    if (searchParams.get('gsc') === 'reconnected') {
      setMessage('Search Console reconnected. Stored metrics will refresh on the next sync.')
    }

    if (searchParams.get('gsc') === 'pick_properties') {
      void loadAccountProperties()
    }

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
  }, [searchParams, siteId, loadAccountProperties])

  async function startAccountConnect() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/gsc/connect?action=connect')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not start Google connection')
      window.location.href = data.authorizeUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect failed')
      setBusy(false)
    }
  }

  async function startSiteConnect() {
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

  // Deep-link from checklist: ?gsc=reconnect&siteId=… starts site OAuth immediately.
  useEffect(() => {
    if (searchParams.get('gsc') !== 'reconnect') return
    if (!siteId) return
    void startSiteConnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot when siteId is ready
  }, [searchParams, siteId])

  async function registerSelectedProperties() {
    const urls = Array.from(selectedProperties)
    if (urls.length === 0) {
      setError('Select at least one Search Console property to track.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage('Creating sites and attaching Search Console mappings…')
    try {
      const res = await fetch('/api/gsc/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyUrls: urls }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not register properties')

      const created = (data.registered || []).filter((r: { createdSite: boolean }) => r.createdSite)
      const mapped = data.registered || []
      // Keep the full property checklist visible so the user can keep adding others
      // in the same flow — do not dismiss after one register batch.
      setMessage(
        [
          `Tracking ${mapped.length} propert${mapped.length === 1 ? 'y' : 'ies'}`,
          created.length ? `(${created.length} new site${created.length === 1 ? '' : 's'} created)` : null,
          data.syncNote || null,
          data.sync?.error ? `Sync note: ${data.sync.error}` : null,
          'Remaining properties stay listed below — select more anytime.',
        ]
          .filter(Boolean)
          .join(' — '),
      )
      const list = await reloadSites()
      await loadAccount()
      // Refresh checklist in place (alreadyTracked updates; untracked stay selectable).
      await loadAccountProperties()
      const prefer =
        mapped[0]?.siteId && list.some((s: Site) => s.id === mapped[0].siteId)
          ? mapped[0].siteId
          : list[0]?.id || ''
      setSiteId(prefer)
      if (prefer) await loadStatus(prefer)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Register failed')
    } finally {
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

  async function fetchSuggestion(url: string) {
    if (!siteId) return
    setSuggestions((s) => ({ ...s, [url]: { ...(s[url] || {}), loading: true, error: null, currentTitle: null, currentDescription: null, suggestedTitle: null, suggestedDescription: null, targetedQueries: [] } }))
    try {
      const res = await fetch(`/api/gsc/title-meta/suggest?siteId=${encodeURIComponent(siteId)}&url=${encodeURIComponent(url)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not build suggestion')
      const sug = data.suggestion
      setSuggestions((s) => ({
        ...s,
        [url]: {
          currentTitle: sug?.currentTitle ?? null,
          currentDescription: sug?.currentDescription ?? null,
          suggestedTitle: sug?.suggestedTitle ?? null,
          suggestedDescription: sug?.suggestedDescription ?? null,
          targetedQueries: sug?.targetedQueries ?? [],
          loading: false,
          error: null,
        },
      }))
    } catch (err) {
      setSuggestions((s) => ({
        ...s,
        [url]: { ...(s[url] || {}), loading: false, error: err instanceof Error ? err.message : 'Failed', currentTitle: null, currentDescription: null, suggestedTitle: null, suggestedDescription: null, targetedQueries: [] },
      }))
    }
  }

  async function openTitleMetaPr(row: { url: string }) {
    const sug = suggestions[row.url]
    if (!sug || (!sug.suggestedTitle && !sug.suggestedDescription)) return
    const res = await fetch('/api/gsc/title-meta/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId,
        url: row.url,
        title: sug.suggestedTitle,
        description: sug.suggestedDescription,
        queries: sug.targetedQueries,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Could not open PR')
      return
    }
    setMessage('Proposed PR branch prepared — open the Findings tab to approve and commit.')
  }

  async function fetchInternalLinkSuggestions(targetUrl: string) {
    if (!siteId) return
    setLinkSuggestions((s) => ({ ...s, [targetUrl]: { ...(s[targetUrl] || { anchorText: '', sources: [] }), loading: true, error: null } }))
    try {
      const res = await fetch(`/api/gsc/internal-links/suggest?siteId=${encodeURIComponent(siteId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not build suggestions')
      const entry = (data.suggestions as Array<{
        targetUrl: string
        anchorText: string
        sources: Array<{ sourceUrl: string; insertion: 'related-list' }>
      }> | []).find((e) => e.targetUrl === targetUrl)
      if (!entry) {
        setLinkSuggestions((s) => ({ ...s, [targetUrl]: { anchorText: '', sources: [], loading: false, error: 'No suggestions' } }))
        return
      }
      setLinkSuggestions((s) => ({
        ...s,
        [targetUrl]: { anchorText: entry.anchorText, sources: entry.sources, loading: false, error: null },
      }))
    } catch (err) {
      setLinkSuggestions((s) => ({
        ...s,
        [targetUrl]: { anchorText: '', sources: [], loading: false, error: err instanceof Error ? err.message : 'Failed' },
      }))
    }
  }

  async function openInternalLinksPr(targetUrl: string, sourceUrl: string) {
    const entry = linkSuggestions[targetUrl]
    if (!entry || entry.sources.length === 0) return
    const target = entry.sources.find((s) => s.sourceUrl === sourceUrl)
    if (!target) return
    const res = await fetch('/api/gsc/internal-links/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId,
        sourceUrl,
        targets: [{ href: targetUrl, anchorText: linkSuggestions[targetUrl].anchorText }],
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Could not open PR')
      return
    }
    setMessage('Proposed PR branch prepared — open the Findings tab to approve and commit.')
  }

  async function fetchContentGaps(url: string) {
    if (!siteId) return
    setContentGaps((s) => ({ ...s, [url]: { ...(s[url] || { basis: 'queries-only', gaps: [], notes: [] }), loading: true, error: null } }))
    try {
      const res = await fetch(`/api/gsc/content-gaps/suggest?siteId=${encodeURIComponent(siteId)}&url=${encodeURIComponent(url)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not build content gaps brief')
      const brief = data.brief
      if (!brief) {
        setContentGaps((s) => ({ ...s, [url]: { basis: 'queries-only', gaps: [], notes: [], loading: false, error: 'No data' } }))
        return
      }
      setContentGaps((s) => ({
        ...s,
        [url]: {
          basis: brief.basis,
          gaps: brief.gaps || [],
          notes: brief.notes || [],
          loading: false,
          error: null,
        },
      }))
    } catch (err) {
      setContentGaps((s) => ({
        ...s,
        [url]: { ...(s[url] || { basis: 'queries-only', gaps: [], notes: [] }), loading: false, error: err instanceof Error ? err.message : 'Failed' },
      }))
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

  function toggleProperty(siteUrl: string, alreadyTracked: boolean) {
    if (alreadyTracked) return
    setSelectedProperties((prev) => {
      const next = new Set(prev)
      if (next.has(siteUrl)) next.delete(siteUrl)
      else next.add(siteUrl)
      return next
    })
  }

  const accountConnected = !!(account && account.status === 'active')
  const accountExpired = account?.status === 'expired' || account?.status === 'revoked'
  const isExpired = connection?.status === 'expired' || connection?.status === 'revoked'
  const isActive = connection?.status === 'active'
  /** Any stored GSC row for this site (active, expired, or revoked). */
  const hasConnectionRow = !!connection
  const hasProperty = !!(connection?.property_url)
  const selectedSite = sites.find((s) => s.id === siteId)
  const statusLabel =
    connection?.status === 'active'
      ? 'Connected'
      : connection?.status === 'expired'
        ? 'Expired — reconnect'
        : connection?.status === 'revoked'
          ? 'Revoked'
          : 'Not connected'
  const lastSyncLabel = connection?.last_sync_at
    ? new Date(connection.last_sync_at).toLocaleString()
    : 'never'

  return (
    <div
      className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden"
      style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}
    >
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8 space-y-6">
          <div>
            <h1 className="text-2xl font-semibold mb-2">Google status</h1>
            <p className="text-[#6B6B6B]">
              What Google last recorded for this site, and which fixes actually move Search Console
              outcomes. Measurement windows are weeks, not days: only a small share of pages reach
              the top 10 within a year, so short windows will look flat even when the method is working.
            </p>
          </div>

          {/* Account-level GSC entry — primary onboarding path */}
          <div className="border border-[#E5E5E5] rounded-lg px-4 py-4 bg-white space-y-3">
            <h2 className="font-medium">Connect Google Search Console</h2>
            <p className="text-sm text-[#6B6B6B]">
              Start here. After you connect, we list every Search Console property on that Google
              account — pick the ones to track and we create a site for each host with GSC already
              attached. GitHub, WordPress, and Shopify stay a separate per-site step.
            </p>
            {accountConnected ? (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-sm text-[#6B6B6B]">
                  Google account: Connected
                  {account?.connected_at
                    ? ` · since ${new Date(account.connected_at).toLocaleDateString()}`
                    : ''}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void loadAccountProperties()}
                  className="px-3 py-1.5 rounded-lg bg-[#0F0F0F] text-white text-sm disabled:opacity-50"
                >
                  {busy ? 'Loading…' : 'Choose properties to track'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startAccountConnect()}
                  className="text-sm underline text-[#6B6B6B]"
                >
                  Reconnect Google
                </button>
              </div>
            ) : accountExpired ? (
              <div className="space-y-2">
                <p className="text-sm text-amber-900">
                  Google account authorization expired
                  {account?.last_error ? `: ${account.last_error}` : ''}. Reconnect to list
                  properties again.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startAccountConnect()}
                  className="px-4 py-2 rounded-lg bg-[#0F0F0F] text-white disabled:opacity-50"
                >
                  {busy ? 'Redirecting…' : 'Reconnect Google Search Console'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void startAccountConnect()}
                className="px-4 py-2 rounded-lg bg-[#0F0F0F] text-white disabled:opacity-50"
              >
                {busy ? 'Redirecting…' : 'Connect Google Search Console'}
              </button>
            )}
            <p className="text-xs text-[#9B9B9B]">
              Sites without a Google property can still be added manually in Settings → Your Sites.
            </p>
          </div>

          {pickingProperties && (
            <div className="border border-[#E5E5E5] rounded-lg px-4 py-4 bg-white space-y-3">
              <h2 className="font-medium">Select properties to track</h2>
              <p className="text-sm text-[#6B6B6B]">
                Each selected property becomes its own site (exact host). Already-tracked properties
                stay checked and disabled. After you save, this list stays open so you can keep
                adding others without starting over.
              </p>
              {properties.length === 0 ? (
                <p className="text-sm text-[#6B6B6B]">No properties found on this Google account.</p>
              ) : (
                <ul className="space-y-2">
                  {properties.map((p) => {
                    const checked = p.alreadyTracked || selectedProperties.has(p.siteUrl)
                    return (
                      <li key={p.siteUrl}>
                        <label
                          className={`flex gap-3 items-start border border-[#E5E5E5] rounded-lg px-3 py-2 ${
                            p.alreadyTracked ? 'bg-[#FAFAF8] opacity-80' : 'hover:bg-[#FAFAF8] cursor-pointer'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={checked}
                            disabled={busy || !!p.alreadyTracked}
                            onChange={() => toggleProperty(p.siteUrl, !!p.alreadyTracked)}
                          />
                          <span className="min-w-0">
                            <span className="block font-medium text-sm break-all">{p.siteUrl}</span>
                            <span className="block text-xs text-[#6B6B6B]">
                              {p.permissionLevel}
                              {p.domain ? ` · ${p.domain}` : ''}
                              {p.alreadyTracked ? ' · already tracking' : ''}
                              {p.siteExists && !p.alreadyTracked ? ' · site exists — will attach GSC' : ''}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || selectedProperties.size === 0}
                  onClick={() => void registerSelectedProperties()}
                  className="px-4 py-2 rounded-lg bg-[#0F0F0F] text-white disabled:opacity-50"
                >
                  {busy
                    ? 'Saving…'
                    : `Track ${selectedProperties.size} propert${selectedProperties.size === 1 ? 'y' : 'ies'}`}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPickingProperties(false)}
                  className="px-3 py-2 rounded-lg border border-[#E5E5E5] text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {sites.length > 0 && (
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
              <p className="text-xs text-[#9B9B9B] w-full">
                {sites.length} registered site{sites.length === 1 ? '' : 's'} — each has its own
                baseline and readiness check.
              </p>
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

          {loading && siteId && <p className="text-sm text-[#6B6B6B]">Loading site…</p>}

          {!loading && siteId && !hasConnectionRow && !pickingProperties && (
            <div className="border border-[#E5E5E5] rounded-lg px-4 py-4 bg-white space-y-3">
              <h2 className="font-medium">This site has no Search Console mapping</h2>
              <p className="text-sm text-[#6B6B6B]">
                Prefer the full property checklist above so you can attach several hosts at once.
                Connecting GSC for this site alone still works if you only need one mapping.
              </p>
              <div className="flex flex-wrap gap-2">
                {accountConnected ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void loadAccountProperties()}
                    className="px-4 py-2 rounded-lg bg-[#0F0F0F] text-white text-sm disabled:opacity-50"
                  >
                    {busy ? 'Loading…' : 'Show all account properties'}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy || !siteId}
                  onClick={() => void startSiteConnect()}
                  className="px-4 py-2 rounded-lg border border-[#E5E5E5] bg-white text-sm disabled:opacity-50"
                >
                  {busy ? 'Redirecting…' : 'Connect GSC for this site only'}
                </button>
              </div>
            </div>
          )}

          {!loading && isExpired && hasProperty && !pickingProperties && (
            <div className="border border-amber-300 rounded-lg px-4 py-4 bg-amber-50 space-y-3">
              <h2 className="font-medium text-amber-950">Search Console authorization expired</h2>
              <p className="text-sm text-amber-900">
                <span className="font-medium">{selectedSite?.domain || 'This site'}</span>
                {connection?.property_url ? ` · ${connection.property_url}` : ''} cannot sync.
                Last successful sync: {lastSyncLabel}. Google rejected the stored refresh token
                {connection?.last_error ? ` (${connection.last_error})` : ''} — Sync cannot renew it.
              </p>
              <p className="text-sm text-amber-900">
                Reconnect to authorize offline access again. Experiments and readiness stay hidden
                until a live token is restored — older metrics are not shown as current.
              </p>
              <button
                type="button"
                disabled={busy || !siteId}
                onClick={() => void startSiteConnect()}
                className="px-4 py-2 rounded-lg bg-[#0F0F0F] text-white text-sm disabled:opacity-50"
              >
                {busy ? 'Redirecting…' : 'Reconnect Search Console'}
              </button>
            </div>
          )}

          {!loading && hasConnectionRow && !isExpired && (pickingProperty || !hasProperty) && !pickingProperties && (
            <div className="border border-[#E5E5E5] rounded-lg px-4 py-4 bg-white space-y-3">
              <h2 className="font-medium">Attach a Search Console property to this site</h2>
              <p className="text-sm text-[#6B6B6B]">
                Status: {statusLabel}. To onboard several hosts at once, use &quot;Choose properties to
                track&quot; above — the checklist stays open after each save. Below is the single-site
                attach path only.
              </p>
              {accountConnected ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPickingProperty(false)
                    void loadAccountProperties()
                  }}
                  className="px-4 py-2 rounded-lg bg-[#0F0F0F] text-white text-sm disabled:opacity-50"
                >
                  {busy ? 'Loading…' : 'Open full property checklist'}
                </button>
              ) : null}
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
                  Load properties for this site
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
            </div>
          )}

          {!loading && isExpired && !hasProperty && !pickingProperties && (
            <div className="border border-amber-300 rounded-lg px-4 py-4 bg-amber-50 space-y-3">
              <h2 className="font-medium text-amber-950">Search Console authorization expired</h2>
              <p className="text-sm text-amber-900">
                <span className="font-medium">{selectedSite?.domain || 'This site'}</span> has an
                expired Google token and no property attached. Last successful sync: {lastSyncLabel}.
                Reconnect, then pick a property.
              </p>
              <button
                type="button"
                disabled={busy || !siteId}
                onClick={() => void startSiteConnect()}
                className="px-4 py-2 rounded-lg bg-[#0F0F0F] text-white text-sm disabled:opacity-50"
              >
                {busy ? 'Redirecting…' : 'Reconnect Search Console'}
              </button>
            </div>
          )}

          {!loading && isActive && hasProperty && (
            <div className="space-y-4">
              <div className="border border-[#E5E5E5] rounded-lg px-4 py-3 bg-white">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {(
                    [
                      ['Baseline', pipelineStatus?.baseline],
                      ['Intervention', pipelineStatus?.intervention],
                      ['Verified', pipelineStatus?.verified],
                      ['Measuring', pipelineStatus?.measuring],
                      ['Result', pipelineStatus?.result],
                    ] as const
                  ).map(([label, done], idx, arr) => (
                    <div key={label} className="flex items-center gap-2">
                      <span
                        className={
                          done
                            ? 'font-medium text-[#0F0F0F]'
                            : 'text-[#9B9B9B]'
                        }
                      >
                        {label}
                      </span>
                      {idx < arr.length - 1 && (
                        <span className="text-[#C4C4C4]" aria-hidden>
                          →
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

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
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void (async () => {
                          setBusy(true)
                          setError(null)
                          try {
                            const res = await fetch('/api/experiments/analyze', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ siteId }),
                            })
                            const data = await res.json()
                            if (!res.ok) throw new Error(data.error || 'Analyze failed')
                            setMessage(data.message || 'Analysis complete')
                            await loadStatus(siteId)
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Analyze failed')
                          } finally {
                            setBusy(false)
                          }
                        })()
                      }}
                      className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] bg-white text-sm disabled:opacity-50"
                    >
                      Run analysis
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void startSiteConnect()}
                      className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] bg-white text-sm text-[#6B6B6B] disabled:opacity-50"
                    >
                      Reconnect
                    </button>
                  </div>
                </div>
              </div>

              <div className="border border-[#E5E5E5] rounded-lg px-4 py-4 bg-white space-y-3">
                <h2 className="font-medium">Interventions</h2>
                {interventions.length === 0 ? (
                  <p className="text-sm text-[#6B6B6B]">
                    No interventions recorded yet (Fix Agent has not persisted an
                    intervention_events row for this site).
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs text-[#6B6B6B] border-b border-[#E5E5E5]">
                        <tr>
                          <th className="py-2 pr-3 font-medium">Type</th>
                          <th className="py-2 pr-3 font-medium">Applied</th>
                          <th className="py-2 pr-3 font-medium">Treatment / control</th>
                          <th className="py-2 pr-3 font-medium">Lifecycle</th>
                          <th className="py-2 pr-3 font-medium">Validity</th>
                          <th className="py-2 font-medium">Effect</th>
                        </tr>
                      </thead>
                      <tbody>
                        {interventions.map((row) => {
                          const result = causalResults.find(
                            (r) => r.intervention_id === row.id && !r.is_exploratory,
                          )
                          const splitOk = row.interference_scope === 'url'
                          const effectLabel =
                            result?.validity_status === 'valid' && result.effect_estimate != null
                              ? result.effect_estimate.toFixed(3)
                              : 'insufficient evidence'
                          return (
                            <tr key={row.id} className="border-b border-[#F0F0F0]">
                              <td className="py-2 pr-3">
                                {row.intervention_type}/{row.intervention_subtype}
                              </td>
                              <td className="py-2 pr-3">
                                {row.applied_at
                                  ? new Date(row.applied_at).toLocaleDateString()
                                  : '—'}
                              </td>
                              <td className="py-2 pr-3">
                                {splitOk
                                  ? result
                                    ? `${result.treatment_n ?? 0} / ${result.control_n ?? 0}`
                                    : '—'
                                  : 'pre/post only'}
                              </td>
                              <td className="py-2 pr-3">{row.lifecycle_state}</td>
                              <td className="py-2 pr-3">
                                {result?.validity_status || 'insufficient evidence'}
                              </td>
                              <td className="py-2">{effectLabel}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="border border-[#E5E5E5] rounded-lg px-4 py-4 bg-white space-y-3">
            {weekly ? (
              <div className="mb-3 border border-[#F0F0F0] rounded-lg p-3 bg-[#FCFCFA]">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="font-medium">This week</h2>
                    <p className="text-xs text-[#6B6B6B]">Week ending {weekly.weekEnding} — finalized GSC only</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="text-center">
                      <div className="text-[18px] font-semibold text-[#0F0F0F]">{weekly.totals.clicks.current.toLocaleString()}</div>
                      <div className="text-xs text-[#6B6B6B]">Clicks ({weekly.totals.clicks.delta >= 0 ? '+' : ''}{weekly.totals.clicks.delta})</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[18px] font-semibold text-[#0F0F0F]">{weekly.totals.impressions.current.toLocaleString()}</div>
                      <div className="text-xs text-[#6B6B6B]">Impr. ({weekly.totals.impressions.delta >= 0 ? '+' : ''}{weekly.totals.impressions.delta})</div>
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-xs">
                  {weekly.wins.length > 0 ? (
                    <div>
                      <span className="font-medium text-[#0F0F0F]">Wins:</span>{' '}
                      {weekly.wins.map((w, i) => (
                        <span key={i} className="mr-2">
                          “{w.query}” pos {w.week2.avg_position.toFixed(1)} ({w.clicksDelta >= 0 ? '+' : ''}{w.clicksDelta} clicks)
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div>No clear week‑over‑week improvements yet.</div>
                  )}
                  {weekly.nextAction ? (
                    <div className="mt-1">
                      <span className="font-medium text-[#0F0F0F]">Next:</span>{' '}
                      {weekly.nextAction.suggestedFix === 'title_meta'
                        ? 'Improve title/description'
                        : weekly.nextAction.suggestedFix === 'internal_links'
                          ? 'Add internal links'
                          : weekly.nextAction.suggestedFix === 'content_gaps'
                            ? 'Cover missing subtopics'
                            : 'Add schema'}{' '}
                      for “{weekly.nextAction.query}”.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
                <div className="flex flex-wrap justify-between gap-2 items-start">
                  <div>
                    <h2 className="font-medium">Page‑2 opportunities</h2>
                    <p className="text-sm text-[#6B6B6B]">
                      Queries and pages with average position 8–20 in the last{' '}
                      {opportunities?.windowDays ?? 28} days, sorted by opportunity
                      (impressions × closeness to top 5).
                    </p>
                  </div>
                </div>
                {!opportunities ? (
                  <p className="text-sm text-[#6B6B6B]">Loading…</p>
                ) : opportunities.opportunities.length === 0 ? (
                  <p className="text-sm text-[#6B6B6B]">
                    No finalized Search Console data in range. Connect Search Console above, then
                    check back after the next sync.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs text-[#6B6B6B] border-b border-[#E5E5E5]">
                        <tr>
                          <th className="py-2 pr-3 font-medium">Query</th>
                          <th className="py-2 pr-3 font-medium">Page</th>
                          <th className="py-2 pr-3 font-medium">Avg. position</th>
                          <th className="py-2 pr-3 font-medium">Impr.</th>
                          <th className="py-2 pr-3 font-medium">Clicks</th>
                          <th className="py-2 pr-3 font-medium">CTR</th>
                          <th className="py-2 font-medium">Suggested actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {opportunities.opportunities.slice(0, 20).map((row, idx) => (
                          <tr key={`${row.query}\0${row.url}\0${idx}`} className="border-b border-[#F0F0F0] align-top">
                            <td className="py-2 pr-3 max-w-[280px] break-words">{row.query}</td>
                            <td className="py-2 pr-3 max-w-[360px] break-all text-[#0F0F0F]">{row.url}</td>
                            <td className="py-2 pr-3">{row.avg_position.toFixed(1)}</td>
                            <td className="py-2 pr-3">{row.impressions.toLocaleString()}</td>
                            <td className="py-2 pr-3">{row.clicks.toLocaleString()}</td>
                            <td className="py-2 pr-3">{(row.ctr * 100).toFixed(1)}%</td>
                          <td className="py-2 align-top">
                            <div className="mt-2">
                              <button
                                className="text-xs px-2 py-1 border rounded hover:bg-[#F5F5F2]"
                                onClick={() => fetchInternalLinkSuggestions(row.url)}
                                disabled={Boolean(linkSuggestions[row.url]?.loading)}
                              >
                                {linkSuggestions[row.url]?.loading ? 'Finding link opportunities…' : 'Get internal link suggestions'}
                              </button>
                            </div>
                            <div className="mt-2">
                              <button
                                className="text-xs px-2 py-1 border rounded hover:bg-[#F5F5F2]"
                                onClick={() => fetchContentGaps(row.url)}
                                disabled={Boolean(contentGaps[row.url]?.loading)}
                              >
                                {contentGaps[row.url]?.loading ? 'Analysing content gaps…' : 'Content gaps'}
                              </button>
                            </div>
                            {linkSuggestions[row.url] && !linkSuggestions[row.url]?.loading && (
                              <div className="mt-2 text-xs">
                                {linkSuggestions[row.url]?.error ? (
                                  <div className="text-red-600">{linkSuggestions[row.url]?.error}</div>
                                ) : linkSuggestions[row.url]?.sources.length === 0 ? (
                                  <div>No suggestions.</div>
                                ) : (
                                  <div className="space-y-1">
                                    <div>
                                      <span className="font-medium text-[#0F0F0F]">Anchor:</span> {linkSuggestions[row.url]?.anchorText}
                                    </div>
                                    <div className="font-medium text-[#0F0F0F]">Suggested sources:</div>
                                    <ul className="list-disc pl-5 space-y-1">
                                      {linkSuggestions[row.url]?.sources.map((s, i) => (
                                        <li key={i}>
                                          <span className="break-all">{s.sourceUrl}</span>{' '}
                                          <button
                                            className="ml-2 text-xs px-2 py-0.5 border rounded bg-[#0F0F0F] text-white hover:opacity-90"
                                            onClick={() => openInternalLinksPr(row.url, s.sourceUrl)}
                                          >
                                            Create PR
                                          </button>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}
                            {contentGaps[row.url] && !contentGaps[row.url]?.loading && (
                              <div className="mt-2 text-xs">
                                {contentGaps[row.url]?.error ? (
                                  <div className="text-red-600">{contentGaps[row.url]?.error}</div>
                                ) : contentGaps[row.url]?.gaps.length === 0 ? (
                                  <div>No clear gaps detected.</div>
                                ) : (
                                  <div className="space-y-1">
                                    <div className="font-medium text-[#0F0F0F]">What’s missing:</div>
                                    <ul className="list-disc pl-5 space-y-1">
                                      {contentGaps[row.url]?.gaps.map((g, i) => (
                                        <li key={i}>
                                          <span className="text-[#0F0F0F]">{g.gap}</span>
                                          {g.servesQueries?.length ? (
                                            <span className="ml-2 text-[#6B6B6B]">({g.servesQueries.join(', ')})</span>
                                          ) : null}
                                        </li>
                                      ))}
                                    </ul>
                                    {contentGaps[row.url]?.notes?.length ? (
                                      <p className="text-[#6B6B6B]">{contentGaps[row.url]?.notes.join(' ')}</p>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            )}
                              <ul className="list-disc pl-5 space-y-0.5">
                                {row.suggested_actions.map((a, i) => (
                                  <li key={i} className="text-[#0F0F0F]">{a}</li>
                                ))}
                              </ul>
                            <div className="mt-2">
                              <button
                                className="text-xs px-2 py-1 border rounded hover:bg-[#F5F5F2]"
                                onClick={() => fetchSuggestion(row.url)}
                                disabled={Boolean(suggestions[row.url]?.loading)}
                              >
                                {suggestions[row.url]?.loading ? 'Building…' : 'Get title/description suggestion'}
                              </button>
                            </div>
                            {suggestions[row.url] && !suggestions[row.url]?.loading && (
                              <div className="mt-2 text-xs">
                                {suggestions[row.url]?.error ? (
                                  <div className="text-red-600">{suggestions[row.url]?.error}</div>
                                ) : (
                                  <>
                                    <div>
                                      <span className="font-medium text-[#0F0F0F]">Title:</span>{' '}
                                      <span className="line-through decoration-red-400/70">{suggestions[row.url]?.currentTitle || '—'}</span>{' '}
                                      → <span className="text-[#0F0F0F]">{suggestions[row.url]?.suggestedTitle || '—'}</span>
                                    </div>
                                    <div className="mt-1">
                                      <span className="font-medium text-[#0F0F0F]">Description:</span>{' '}
                                      <span className="line-through decoration-red-400/70">{suggestions[row.url]?.currentDescription || '—'}</span>{' '}
                                      → <span className="text-[#0F0F0F]">{suggestions[row.url]?.suggestedDescription || '—'}</span>
                                    </div>
                                    <div className="mt-1">
                                      <span className="font-medium text-[#0F0F0F]">Targets queries:</span> {suggestions[row.url]?.targetedQueries.join(', ') || '—'}
                                    </div>
                                    <div className="mt-2">
                                      <button
                                        className="text-xs px-2 py-1 border rounded bg-[#0F0F0F] text-white hover:opacity-90 disabled:opacity-50"
                                        onClick={() => openTitleMetaPr(row)}
                                        disabled={!suggestions[row.url]?.suggestedTitle && !suggestions[row.url]?.suggestedDescription}
                                      >
                                        Create PR
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-xs text-[#9B9B9B] mt-2">
                      Observational guidance only — no ranking promises. Based on finalized Search Console
                      data from {opportunities.startDate} to {opportunities.endDate}.
                    </p>
                  </div>
                )}
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
                    experiment.
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
                    disabled={busy || !siteId}
                    className="px-4 py-2 rounded-lg bg-[#0F0F0F] text-white disabled:opacity-40"
                    onClick={async () => {
                      if (!siteId) return
                      setBusy(true)
                      setError(null)
                      try {
                        const res = await fetch('/api/experiments/create', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ siteId }),
                        })
                        const data = await res.json().catch(() => ({}))
                        if (!res.ok) throw new Error(data.error || 'Could not create experiment')
                        setMessage(
                          `Experiment created (${data.experiment?.id}). Pre-registration locked. Linked ${
                            data.linkedInterventionIds?.length || 0
                          } intervention(s).`,
                        )
                        await loadStatus(siteId)
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Create failed')
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    Create experiment
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

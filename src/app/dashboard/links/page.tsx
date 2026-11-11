'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { getSupabaseClient } from '@/lib/supabase-client'
import { DashboardNav } from '@/components/DashboardNav'
import { InternalLinkMapCanvas, type MapView } from '@/components/internal-link-map/InternalLinkMapCanvas'
import { CRAWL_STATUS_POLL_MS, crawlProgressKind } from '@/lib/fix-strategies/findings-ui/crawl/crawl-progress-ui'
import { readParamFromUrl, writeParamToUrl } from '@/lib/site-selection-url'
import type {
  LinkHealthIssueItem,
  LinkHealthResponse,
  LinkMapApprovalItem,
  LinkMapApprovalsResponse,
  LinkMapResponse,
  LinkPlanResponse,
  PlannedLink,
} from '@/lib/internal-link-map/client-types'
import type { User } from '@supabase/supabase-js'
import type { FixFlowState } from '@/lib/fix-strategies/findings-ui/client'
import {
  fixActionError,
  summarizeApprovalBatch,
} from '@/lib/internal-link-map/approval-results'

type Site = { id: string; domain: string; brand: string | null }

const SITE_QUERY_PARAM = 'site'
const readSiteIdFromUrl = () => readParamFromUrl(SITE_QUERY_PARAM)
const writeSiteIdToUrl = (id: string) => writeParamToUrl(SITE_QUERY_PARAM, id || null)

function fmtDepth(n: number | null): string {
  if (n == null) return '—'
  return n.toFixed(1)
}

function pathOf(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '') || '/'
}

const STATUS_LABEL: Record<LinkMapApprovalItem['status'], string> = {
  pending: 'Pending',
  approved: 'Approved',
  pr_opened: 'PR opened',
  merged: 'Merged',
  rejected: 'Rejected',
}

export default function InternalLinkMapPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState('')
  const [data, setData] = useState<LinkMapResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<MapView>('web')
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null)
  const [fixMsg, setFixMsg] = useState<string | null>(null)
  const [fixBusy, setFixBusy] = useState(false)
  const [plan, setPlan] = useState<LinkPlanResponse | null>(null)
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(new Set())
  const [planBusy, setPlanBusy] = useState(false)
  const [planMsg, setPlanMsg] = useState<string | null>(null)
  const [approvals, setApprovals] = useState<LinkMapApprovalItem[]>([])
  const [approvalHistory, setApprovalHistory] = useState<LinkMapApprovalItem[]>([])
  const [selectedApprovalIds, setSelectedApprovalIds] = useState<Set<string>>(
    new Set(),
  )
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null)
  const [approvalMsg, setApprovalMsg] = useState<string | null>(null)
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>(
    {},
  )
  const [health, setHealth] = useState<LinkHealthIssueItem[]>([])
  const [healthBusy, setHealthBusy] = useState(false)
  const [healthMsg, setHealthMsg] = useState<string | null>(null)

  useEffect(() => {
    const supabase = getSupabaseClient()
    void supabase.auth.getUser().then(
      async ({ data: { user } }: { data: { user: User | null } }) => {
        if (!user) return
        const { data: list } = await supabase
          .from('connected_sites')
          .select('id, domain, brand')
          .eq('user_id', user.id)
          .order('is_primary', { ascending: false })
        const rows = (list || []) as Site[]
        setSites(rows)
        if (rows[0]) {
          const fromUrl = readSiteIdFromUrl()
          const initial =
            (fromUrl && rows.find((r) => r.id === fromUrl)?.id) || rows[0].id
          setSiteId(initial)
          writeSiteIdToUrl(initial)
        }
      },
    )
  }, [])

  const load = useCallback(async (id: string, url: string | null, quiet = false) => {
    if (!id) return
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({ siteId: id })
      if (url) q.set('url', url)
      const res = await fetch(`/api/internal-link-map?${q}`)
      const body = (await res.json().catch(() => ({}))) as LinkMapResponse
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setData(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load link map')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadApprovals = useCallback(async (id: string) => {
    if (!id) {
      setApprovals([])
      setApprovalHistory([])
      return
    }
    try {
      const res = await fetch(
        `/api/internal-link-map/approvals?siteId=${encodeURIComponent(id)}`,
      )
      const body = (await res.json().catch(() => ({}))) as LinkMapApprovalsResponse
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      const items = body.items || []
      const history = body.history || []
      setApprovals(items)
      setApprovalHistory(history)
      setSelectedApprovalIds(
        new Set(
          items
            .filter((item) => item.status === 'pending')
            .map((item) => item.id),
        ),
      )
      const unverified = history.filter(
        (item) => item.status === 'merged' && item.verifyBadge == null,
      )
      if (unverified.length > 0) {
        void Promise.all(
          unverified.slice(0, 5).map((item) =>
            fetch('/api/internal-link-map/approvals', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                siteId: id,
                findingId: item.id,
                action: 'verify-live',
              }),
            }),
          ),
        ).then(async () => {
          const again = await fetch(
            `/api/internal-link-map/approvals?siteId=${encodeURIComponent(id)}`,
          )
          const next = (await again.json().catch(() => ({}))) as LinkMapApprovalsResponse
          if (again.ok) {
            setApprovals(next.items || [])
            setApprovalHistory(next.history || [])
          }
        })
      }
    } catch {
      setApprovals([])
      setApprovalHistory([])
    }
  }, [])

  const loadHealth = useCallback(async (id: string) => {
    if (!id) {
      setHealth([])
      return
    }
    try {
      const res = await fetch(
        `/api/internal-link-map/health?siteId=${encodeURIComponent(id)}`,
      )
      const body = (await res.json().catch(() => ({}))) as LinkHealthResponse
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setHealth(body.issues || [])
    } catch {
      setHealth([])
    }
  }, [])

  useEffect(() => {
    if (siteId) void load(siteId, selectedUrl)
  }, [siteId, selectedUrl, load])

  useEffect(() => {
    if (siteId) void loadApprovals(siteId)
  }, [siteId, loadApprovals])

  useEffect(() => {
    if (siteId) void loadHealth(siteId)
  }, [siteId, loadHealth])

  const crawl = data?.crawl ?? null
  const inFlight =
    crawl != null &&
    (crawlProgressKind(crawl) === 'still_working' ||
      crawl.status === 'running' ||
      crawl.status === 'queued')

  useEffect(() => {
    if (!inFlight || !siteId) return
    const id = setInterval(() => {
      void load(siteId, selectedUrl, true)
    }, CRAWL_STATUS_POLL_MS)
    return () => clearInterval(id)
  }, [inFlight, siteId, selectedUrl, load])

  async function sendRelatedFinding(sourceUrl: string, href: string, anchorText: string) {
    if (!siteId) return
    setFixBusy(true)
    setFixMsg(null)
    try {
      const res = await fetch('/api/internal-link-map/suggest-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          sourceUrl,
          targets: [{ href, anchorText }],
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        ok?: boolean
      }
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setFixMsg('Queued below — approve to open a Fix Agent PR. Nothing was changed on the site.')
      await loadApprovals(siteId)
    } catch (e) {
      setFixMsg(e instanceof Error ? e.message : 'Could not queue the suggestion')
    } finally {
      setFixBusy(false)
    }
  }

  async function buildLinkPlan() {
    if (!siteId) return
    setPlanBusy(true)
    setPlanMsg(null)
    try {
      const res = await fetch('/api/internal-link-map/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId }),
      })
      const body = (await res.json().catch(() => ({}))) as LinkPlanResponse
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setPlan(body)
      setSelectedLinkIds(new Set((body.links || []).map((l) => l.id)))
      if (body.graph) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                graph: body.graph,
              }
            : prev,
        )
      }
    } catch (e) {
      setPlanMsg(e instanceof Error ? e.message : 'Could not build a linking plan')
      setPlan(null)
    } finally {
      setPlanBusy(false)
    }
  }

  async function sendPlanToAudit() {
    if (!siteId || !plan) return
    const selected = plan.links.filter((l) => selectedLinkIds.has(l.id))
    if (selected.length === 0) {
      setPlanMsg('Select at least one planned link')
      return
    }
    setPlanBusy(true)
    setPlanMsg(null)
    try {
      const res = await fetch('/api/internal-link-map/suggest-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          links: selected.map((l) => ({
            sourceUrl: l.sourceUrl,
            href: l.href,
            anchorText: l.anchorText,
            reason: l.reason,
            score: l.score,
            weakMatch: l.weakMatch,
          })),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        findingCount?: number
        merged?: boolean
      }
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      if (body.merged) {
        throw new Error('Refusing to continue: this path must never merge a PR')
      }
      setPlanMsg(
        `Queued ${body.findingCount ?? selected.length} Related reading finding(s). Approve below — nothing was applied or merged.`,
      )
      await loadApprovals(siteId)
    } catch (e) {
      setPlanMsg(e instanceof Error ? e.message : 'Could not queue the plan')
    } finally {
      setPlanBusy(false)
    }
  }

  async function queueHealthFixes() {
    if (!siteId) return
    const mechanical = health.filter((i) => i.mechanical)
    if (mechanical.length === 0) {
      setHealthMsg('No mechanical health items to send for approval')
      return
    }
    setHealthBusy(true)
    setHealthMsg(null)
    try {
      const res = await fetch('/api/internal-link-map/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          action: 'queue',
          issueIds: mechanical.map((i) => i.id),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as LinkHealthResponse & {
        queued?: number
        merged?: boolean
      }
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      if (body.merged) {
        throw new Error('Refusing to continue: this path must never merge a PR')
      }
      setHealthMsg(
        `Queued ${body.queued ?? mechanical.length} fix(es) for approval. Nothing was applied or merged.`,
      )
      await loadApprovals(siteId)
    } catch (e) {
      setHealthMsg(e instanceof Error ? e.message : 'Could not queue health fixes')
    } finally {
      setHealthBusy(false)
    }
  }

  function toggleLink(id: string) {
    setSelectedLinkIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleApproval(id: string) {
    setSelectedApprovalIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function approveFinding(id: string): Promise<{
    id: string
    label: string
    ok: boolean
    error?: string
    prUrl?: string | null
  }> {
    const item = approvals.find((a) => a.id === id)
    const label = item?.pageUrl ? pathOf(item.pageUrl) : id
    setApprovalBusyId(id)
    setApprovalMsg(null)
    setApprovalErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    try {
      const approveRes = await fetch(`/api/fix-strategies/findings/${id}/fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      const approveBody = (await approveRes.json().catch(() => ({}))) as {
        error?: string
        fixFlow?: FixFlowState
      }
      const approveErr = fixActionError(
        approveBody,
        approveRes.ok,
        approveRes.status,
      )
      if (approveErr) throw new Error(approveErr)
      const commitRes = await fetch(`/api/fix-strategies/findings/${id}/fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commit' }),
      })
      const commitBody = (await commitRes.json().catch(() => ({}))) as {
        error?: string
        fixFlow?: FixFlowState
      }
      const commitErr = fixActionError(
        commitBody,
        commitRes.ok,
        commitRes.status,
      )
      if (commitErr) throw new Error(commitErr)
      const prUrl = commitBody.fixFlow?.prUrl
      setApprovalMsg(
        prUrl
          ? 'PR opened. SEORANKO does not merge customer PRs — merge it yourself.'
          : 'Approved. Open the PR from the list when GitHub returns a link.',
      )
      await loadApprovals(siteId)
      return { id, label, ok: true, prUrl }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Approve failed'
      setApprovalErrors((prev) => ({ ...prev, [id]: error }))
      setApprovalMsg(error)
      return { id, label, ok: false, error }
    } finally {
      setApprovalBusyId(null)
    }
  }

  async function rejectFinding(id: string) {
    setApprovalBusyId(id)
    setApprovalMsg(null)
    try {
      const res = await fetch('/api/internal-link-map/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, findingId: id, action: 'reject' }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      await loadApprovals(siteId)
    } catch (e) {
      setApprovalMsg(e instanceof Error ? e.message : 'Reject failed')
    } finally {
      setApprovalBusyId(null)
    }
  }

  async function approveSelected() {
    const ids = approvals
      .filter((item) => item.status === 'pending' && selectedApprovalIds.has(item.id))
      .map((item) => item.id)
    if (ids.length === 0) {
      setApprovalMsg('Select at least one pending finding')
      return
    }
    setApprovalBusyId('batch')
    setApprovalMsg(null)
    try {
      const res = await fetch('/api/internal-link-map/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          findingIds: ids,
          action: 'approve-batch',
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        prUrl?: string | null
        items?: LinkMapApprovalItem[]
      }
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      const prUrl = body.prUrl
      const results = ids.map((id) => {
        const item = approvals.find((a) => a.id === id)
        const label = item?.pageUrl ? pathOf(item.pageUrl) : id
        return { id, label, ok: true, prUrl }
      })
      setApprovalMsg(summarizeApprovalBatch(results))
      await loadApprovals(siteId)
    } catch (e) {
      setApprovalMsg(e instanceof Error ? e.message : 'Approve failed')
    } finally {
      setApprovalBusyId(null)
    }
  }

  async function regenerateFinding(id: string) {
    setApprovalBusyId(id)
    setApprovalMsg(null)
    try {
      const res = await fetch('/api/internal-link-map/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, findingId: id, action: 'regenerate' }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setApprovalMsg(
        'Reset to pending. The GitHub PR was not closed — Approve again to open a new PR with the updated related reading block.',
      )
      await loadApprovals(siteId)
    } catch (e) {
      setApprovalMsg(e instanceof Error ? e.message : 'Could not reset this finding')
    } finally {
      setApprovalBusyId(null)
    }
  }

  const selectedPlanned: PlannedLink[] = useMemo(() => {
    if (!plan) return []
    return plan.links.filter((l) => selectedLinkIds.has(l.id))
  }, [plan, selectedLinkIds])

  const plannedEdges = useMemo(
    () => selectedPlanned.map((l) => ({ source: l.sourceUrl, target: l.targetUrl })),
    [selectedPlanned],
  )

  const planForSelected = useMemo(() => {
    if (!plan || !selectedUrl) return []
    return plan.links.filter(
      (l) => l.sourceUrl === selectedUrl || l.targetUrl === selectedUrl,
    )
  }, [plan, selectedUrl])

  const graph = data?.graph ?? null
  const metrics = graph?.metrics
  const detail = data?.detail
  const selected = graph?.nodes.find((n) => n.url === selectedUrl) ?? detail?.node

  return (
    <div
      className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden"
      style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}
    >
      <DashboardNav />
      <main className="flex-1 min-w-0 flex flex-col">
        <div className="px-6 pt-6 pb-3 flex flex-wrap items-end gap-3 border-b border-[#E8E8E4] bg-[#FAFAF8]">
          <div className="min-w-[12rem] flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Link map</h1>
            <p className="text-[#6B6B6B] mt-1 text-sm">
              Internal links from the Audit crawl, drawn as they are found.
            </p>
          </div>
          <label className="text-sm text-[#6B6B6B]">
            Site{' '}
            <select
              className="ml-1 rounded-md border border-[#E8E8E4] bg-white px-2 py-1.5 text-[#0F0F0F]"
              value={siteId}
              onChange={(e) => {
                setSiteId(e.target.value)
                writeSiteIdToUrl(e.target.value)
                setSelectedUrl(null)
                setPlan(null)
                setPlanMsg(null)
                setApprovals([])
                setApprovalMsg(null)
              }}
            >
              {sites.length === 0 && <option value="">No connected sites</option>}
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.brand || s.domain}
                </option>
              ))}
            </select>
          </label>
          <div className="flex rounded-md border border-[#E8E8E4] bg-white overflow-hidden text-sm">
            <button
              type="button"
              className={`px-3 py-1.5 ${view === 'web' ? 'bg-[#0F0F0F] text-white' : 'text-[#6B6B6B]'}`}
              onClick={() => setView('web')}
            >
              Web
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 border-l border-[#E8E8E4] ${
                view === 'tree' ? 'bg-[#0F0F0F] text-white' : 'text-[#6B6B6B]'
              }`}
              onClick={() => setView('tree')}
            >
              Tree
            </button>
          </div>
          <button
            type="button"
            disabled={planBusy || !graph}
            onClick={() => void buildLinkPlan()}
            className="rounded-md bg-[#0F0F0F] text-white text-sm px-3 py-1.5 disabled:opacity-50"
          >
            {planBusy && !plan ? 'Planning…' : 'Link all pages'}
          </button>
        </div>

        {metrics && (
          <div className="px-6 py-3 flex flex-wrap gap-2 text-sm border-b border-[#E8E8E4] bg-white">
            <span className="px-2.5 py-1 rounded-md border border-[#E8E8E4]">
              {metrics.nodeCount} pages · {metrics.edgeCount} links
            </span>
            <span className="px-2.5 py-1 rounded-md border border-[#E8E8E4] text-[#E23D28]">
              {metrics.orphanCount} orphans
            </span>
            <span className="px-2.5 py-1 rounded-md border border-[#E8E8E4] text-[#E08A2A]">
              {metrics.deepCount} more than 3 clicks deep
            </span>
            <span className="px-2.5 py-1 rounded-md border border-[#E8E8E4]">
              {metrics.brokenCount} broken internal links
            </span>
            <span className="px-2.5 py-1 rounded-md border border-[#E8E8E4]">
              avg depth {fmtDepth(metrics.averageDepth)}
            </span>
            {inFlight && crawl && (
              <span className="px-2.5 py-1 rounded-md bg-[#FFF6F2] border border-[#E8C4B8] text-[#0F0F0F]">
                Building… {crawl.urlsCrawled} crawled of {crawl.urlsFound} found
              </span>
            )}
            {crawl?.status === 'complete' || crawl?.status === 'partial' ? (
              <span className="px-2.5 py-1 rounded-md border border-[#E8E8E4] text-[#6B6B6B]">
                {crawl.status === 'partial' ? 'Partial crawl' : 'Crawl complete'}
              </span>
            ) : null}
          </div>
        )}

        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 p-4">
            {error && (
              <p className="mb-3 text-sm text-red-700">{error}</p>
            )}
            {loading && !graph && (
              <p className="text-sm text-[#6B6B6B]">Loading…</p>
            )}
            {!loading && !graph && !error && (
              <div className="h-full flex items-center justify-center">
                <div className="max-w-md text-center">
                  <p className="text-[#0F0F0F] font-medium">No crawl on this site yet</p>
                  <p className="text-sm text-[#6B6B6B] mt-2">
                    Run a crawl on Audit. Pages and veins appear here as each URL is fetched.
                  </p>
                  <Link
                    href={siteId ? `/dashboard/findings?site=${encodeURIComponent(siteId)}` : '/dashboard/findings'}
                    className="inline-block mt-4 rounded-md bg-[#FF6B2C] text-white text-sm px-3 py-1.5"
                  >
                    Open Audit
                  </Link>
                </div>
              </div>
            )}
            {graph && (
              <div className="h-full rounded-md overflow-hidden border border-[#2A2520] shadow-[inset_0_0_0_1px_rgba(255,138,74,0.08)]">
                <InternalLinkMapCanvas
                  nodes={graph.nodes}
                  edges={graph.edges}
                  homepageUrl={graph.homepageUrl}
                  view={view}
                  selectedUrl={selectedUrl}
                  onSelect={setSelectedUrl}
                  plannedEdges={plannedEdges}
                />
              </div>
            )}
          </div>

          <aside className="w-[22rem] flex-shrink-0 border-l border-[#E8E8E4] bg-white text-sm flex flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {plan && (
              <div className="mb-5 pb-4 border-b border-[#E8E8E4]">
                <p className="text-[#0F0F0F] font-medium">Link all pages</p>
                <p className="text-xs text-[#6B6B6B] mt-1 leading-5">
                  Review crawlable Related reading links. Nothing is applied until you
                  click Approve.
                </p>
                <p className="text-xs text-[#9B9B9B] mt-1">
                  {selectedLinkIds.size} of {plan.links.length} selected · dashed on the map
                </p>
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    className="text-xs rounded-md border border-[#E8E8E4] px-2 py-1"
                    onClick={() => setSelectedLinkIds(new Set(plan.links.map((l) => l.id)))}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="text-xs rounded-md border border-[#E8E8E4] px-2 py-1"
                    onClick={() => setSelectedLinkIds(new Set())}
                  >
                    Select none
                  </button>
                </div>
                <ul className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                  {plan.links.map((l) => (
                    <li key={l.id} className="flex gap-2 items-start">
                      <input
                        type="checkbox"
                        className="mt-1 shrink-0"
                        checked={selectedLinkIds.has(l.id)}
                        onChange={() => toggleLink(l.id)}
                      />
                      <button
                        type="button"
                        className="text-left text-xs text-[#6B6B6B] min-w-0"
                        onClick={() => setSelectedUrl(l.sourceUrl)}
                      >
                        <span className="text-[#0F0F0F] break-all">
                          {pathOf(l.sourceUrl)}
                          {' → '}
                          {pathOf(l.targetUrl)}
                        </span>
                        <span className="block text-[#9B9B9B]">“{l.anchorText}”</span>
                        <span className="block">
                          {typeof l.score === 'number' ? `${Math.round(l.score * 100)}% · ` : ''}
                          {l.reason}
                          {l.weakMatch ? ' · weak match' : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={planBusy || selectedLinkIds.size === 0}
                  onClick={() => void sendPlanToAudit()}
                  className="mt-3 w-full rounded-md bg-[#FF6B2C] text-white text-sm px-3 py-1.5 disabled:opacity-50"
                >
                  Send to Audit for approval
                </button>
                {planMsg && <p className="mt-2 text-xs text-[#6B6B6B] leading-5">{planMsg}</p>}
              </div>
            )}
            {planMsg && !plan && (
              <p className="mb-4 text-xs text-red-700">{planMsg}</p>
            )}

            <div className="mb-5 pb-4 border-b border-[#E8E8E4]">
              <p className="text-[#0F0F0F] font-medium">Link health</p>
              <p className="text-xs text-[#6B6B6B] mt-1 leading-5">
                From the latest crawl. Mechanical fixes go to Approvals — SEORANKO
                never auto-merges.
              </p>
              {health.length === 0 && (
                <p className="text-xs text-[#9B9B9B] mt-3 leading-5">
                  No broken, redirected, duplicate, or generic-anchor issues on this crawl.
                </p>
              )}
              {health.length > 0 && (
                <ul className="mt-3 space-y-2 max-h-56 overflow-y-auto">
                  {health.map((issue) => (
                    <li key={issue.id} className="rounded-md border border-[#E8E8E4] p-2.5">
                      <p className="text-xs text-[#0F0F0F] leading-5">
                        {issue.kind.replace(/-/g, ' ')}
                        {issue.mechanical ? '' : ' · review'}
                      </p>
                      <p className="text-xs text-[#9B9B9B] break-all leading-5 mt-0.5">
                        {pathOf(issue.sourceUrl)}
                        {issue.targetUrl ? ` → ${pathOf(issue.targetUrl)}` : ''}
                      </p>
                      <p className="text-xs text-[#6B6B6B] mt-1 leading-5">{issue.hint}</p>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                disabled={healthBusy || health.every((i) => !i.mechanical)}
                onClick={() => void queueHealthFixes()}
                className="mt-3 w-full rounded-md border border-[#E8E8E4] text-sm px-3 py-1.5 disabled:opacity-50"
              >
                Send mechanical fixes for approval
              </button>
              {healthMsg && (
                <p className="mt-2 text-xs text-[#6B6B6B] leading-5">{healthMsg}</p>
              )}
            </div>

            <div className="mb-5 pb-4 border-b border-[#E8E8E4]">
              <p className="text-[#0F0F0F] font-medium">Approvals</p>
              <p className="text-xs text-[#6B6B6B] mt-1 leading-5">
                Related reading for this site. Approve opens the Fix Agent PR.
                SEORANKO never auto-merges customer PRs.
              </p>
              {approvals.length === 0 && approvalHistory.length === 0 && (
                <p className="text-xs text-[#9B9B9B] mt-3 leading-5">
                  Nothing queued yet. Send planned links, then approve them here.
                </p>
              )}
              {approvals.length === 0 && approvalHistory.length > 0 && (
                <p className="text-xs text-[#9B9B9B] mt-3 leading-5">
                  Nothing waiting for approval. Opened and merged work is in History.
                </p>
              )}
              {approvals.length > 0 && (
                <>
                  <ul className="mt-3 space-y-3">
                    {approvals.map((item) => (
                      <li key={item.id} className="rounded-md border border-[#E8E8E4] p-2.5">
                        <div className="flex gap-2 items-start">
                          {item.status === 'pending' ? (
                            <input
                              type="checkbox"
                              className="mt-1 shrink-0"
                              checked={selectedApprovalIds.has(item.id)}
                              onChange={() => toggleApproval(item.id)}
                            />
                          ) : (
                            <span className="w-4 shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-[#0F0F0F] break-all leading-5">
                              {item.pageUrl ? pathOf(item.pageUrl) : 'Page'}
                            </p>
                            <p className="text-xs text-[#9B9B9B] mt-0.5 leading-5">
                              {item.targets.length} link{item.targets.length === 1 ? '' : 's'}
                              {' · '}
                              {STATUS_LABEL[item.status]}
                              {item.score != null ? ` · ${Math.round(item.score * 100)}%` : ''}
                              {item.weakMatch ? ' · weak match' : ''}
                            </p>
                            {item.reason && (
                              <p className="text-xs text-[#6B6B6B] mt-0.5 leading-5">{item.reason}</p>
                            )}
                            {item.targets.map((t) => (
                              <p key={t.href} className="text-xs text-[#9B9B9B] mt-0.5 leading-5">
                                {t.score != null ? `${Math.round(t.score * 100)}% · ` : ''}
                                “{t.anchorText}”
                                {t.weakMatch ? ' · weak match' : ''}
                                {t.reason ? ` — ${t.reason}` : ''}
                              </p>
                            ))}
                            {item.verifyBadge === 'verified' && (
                              <span className="inline-block mt-1 text-[10px] uppercase tracking-wide rounded bg-[#E7F6EC] text-[#1B7F3A] px-1.5 py-0.5">
                                Verified
                              </span>
                            )}
                            {item.verifyBadge === 'problem' && (
                              <span className="inline-block mt-1 text-[10px] uppercase tracking-wide rounded bg-[#FDECEC] text-[#E23D28] px-1.5 py-0.5">
                                Problem
                              </span>
                            )}
                            {item.prUrl && (
                              <a
                                href={item.prUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block text-xs text-[#FF6B2C] mt-1 break-all"
                              >
                                {item.prNumber != null ? `PR #${item.prNumber}` : 'Open PR'}
                              </a>
                            )}
                            {approvalErrors[item.id] && (
                              <p className="mt-1 text-xs text-[#E23D28] leading-5">
                                {approvalErrors[item.id]}
                              </p>
                            )}
                            {item.status === 'pending' && (
                              <div className="flex gap-2 mt-2">
                                <button
                                  type="button"
                                  disabled={approvalBusyId != null}
                                  onClick={() => void approveFinding(item.id)}
                                  className="text-xs rounded-md bg-[#0F0F0F] text-white px-2 py-1 disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={approvalBusyId != null}
                                  onClick={() => void rejectFinding(item.id)}
                                  className="text-xs rounded-md border border-[#E8E8E4] px-2 py-1 disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                            {item.canRegenerate && (
                              <button
                                type="button"
                                disabled={approvalBusyId != null}
                                onClick={() => void regenerateFinding(item.id)}
                                className="mt-2 text-xs rounded-md border border-[#E8E8E4] px-2 py-1 disabled:opacity-50"
                              >
                                Close & regenerate
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={
                      approvalBusyId != null ||
                      approvals.every(
                        (item) =>
                          item.status !== 'pending' || !selectedApprovalIds.has(item.id),
                      )
                    }
                    onClick={() => void approveSelected()}
                    className="mt-3 w-full rounded-md bg-[#FF6B2C] text-white text-sm px-3 py-1.5 disabled:opacity-50"
                  >
                    Approve all selected
                  </button>
                </>
              )}
              {approvalHistory.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs text-[#6B6B6B]">
                    History ({approvalHistory.length})
                  </summary>
                  <ul className="mt-3 space-y-3">
                    {approvalHistory.map((item) => (
                      <li key={item.id} className="rounded-md border border-[#E8E8E4] p-2.5">
                        <p className="text-xs text-[#0F0F0F] break-all leading-5">
                          {item.pageUrl ? pathOf(item.pageUrl) : 'Page'}
                        </p>
                        <p className="text-xs text-[#9B9B9B] mt-0.5 leading-5">
                          {item.targets.length} link{item.targets.length === 1 ? '' : 's'}
                          {' · '}
                          {STATUS_LABEL[item.status]}
                          {item.score != null ? ` · ${Math.round(item.score * 100)}%` : ''}
                        </p>
                        {item.reason && (
                          <p className="text-xs text-[#6B6B6B] mt-0.5 leading-5">{item.reason}</p>
                        )}
                        {item.targets.map((t) => (
                          <p key={t.href} className="text-xs text-[#9B9B9B] mt-0.5 leading-5">
                            “{t.anchorText}”
                          </p>
                        ))}
                        {item.verifyBadge === 'verified' && (
                          <span className="inline-block mt-1 text-[10px] uppercase tracking-wide rounded bg-[#E7F6EC] text-[#1B7F3A] px-1.5 py-0.5">
                            Verified
                          </span>
                        )}
                        {item.verifyBadge === 'problem' && (
                          <span className="inline-block mt-1 text-[10px] uppercase tracking-wide rounded bg-[#FDECEC] text-[#E23D28] px-1.5 py-0.5">
                            Problem
                          </span>
                        )}
                        {item.prUrl && (
                          <a
                            href={item.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs text-[#FF6B2C] mt-1 break-all"
                          >
                            {item.prNumber != null ? `PR #${item.prNumber}` : 'Open PR'}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {approvalMsg && (
                <p className="mt-2 text-xs text-[#6B6B6B] leading-5 whitespace-pre-wrap">
                  {approvalMsg}
                </p>
              )}
            </div>

            {!selected && (
              <p className="text-[#9B9B9B] leading-5">Click a page on the map to see what links in and out.</p>
            )}
            {selected && (
              <div>
                <p className="font-medium text-[#0F0F0F] break-all">{selected.title || selected.path}</p>
                <p className="text-xs text-[#9B9B9B] mt-1 break-all">{selected.url}</p>
                <p className="mt-2 text-[#6B6B6B] leading-5">
                  {selected.inlinks} in · {selected.outlinks} out
                  {selected.depth != null ? ` · ${selected.depth} clicks from home` : ' · not reached from home'}
                </p>

                <p className="mt-4 font-medium text-[#0F0F0F]">Links in</p>
                <ul className="mt-1 space-y-1">
                  {(detail?.inlinks ?? []).slice(0, 12).map((e) => (
                    <li key={`${e.source}|${e.anchor}`} className="text-[#6B6B6B]">
                      <button
                        type="button"
                        className="text-left underline decoration-[#E8E8E4] hover:text-[#0F0F0F] break-all"
                        onClick={() => setSelectedUrl(e.source)}
                      >
                        {pathOf(e.source)}
                      </button>
                      {e.anchor ? <span className="text-[#9B9B9B]"> — “{e.anchor}”</span> : null}
                    </li>
                  ))}
                  {(detail?.inlinks?.length ?? 0) === 0 && (
                    <li className="text-[#9B9B9B]">None yet</li>
                  )}
                </ul>

                <p className="mt-4 font-medium text-[#0F0F0F]">Links out</p>
                <ul className="mt-1 space-y-1">
                  {(detail?.outlinks ?? []).slice(0, 12).map((e) => (
                    <li key={`${e.target}|${e.anchor}`} className="text-[#6B6B6B]">
                      <button
                        type="button"
                        className="text-left underline decoration-[#E8E8E4] hover:text-[#0F0F0F] break-all"
                        onClick={() => setSelectedUrl(e.target)}
                      >
                        {pathOf(e.target)}
                      </button>
                      {e.broken ? <span className="text-[#E23D28]"> broken</span> : null}
                      {e.redirect ? <span className="text-[#E08A2A]"> redirect</span> : null}
                    </li>
                  ))}
                  {(detail?.outlinks?.length ?? 0) === 0 && (
                    <li className="text-[#9B9B9B]">None yet</li>
                  )}
                </ul>

                {planForSelected.length > 0 && (
                  <>
                    <p className="mt-4 font-medium text-[#0F0F0F]">Planned for this page</p>
                    <ul className="mt-1 space-y-2">
                      {planForSelected.map((l) => (
                        <li key={l.id} className="text-[#6B6B6B] text-xs leading-5">
                          <p className="break-all">
                            {l.sourceUrl === selectedUrl ? 'Out' : 'In'} ·{' '}
                            {pathOf(l.sourceUrl === selectedUrl ? l.targetUrl : l.sourceUrl)}
                          </p>
                          <p className="text-[#9B9B9B]">“{l.anchorText}” — {l.reason}</p>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <p className="mt-4 font-medium text-[#0F0F0F]">Pages that should link here</p>
                <ul className="mt-1 space-y-2">
                  {(detail?.suggestions ?? []).map((s) => (
                    <li key={s.sourceUrl} className="text-[#6B6B6B]">
                      <p className="break-all">{pathOf(s.sourceUrl)}</p>
                      <p className="text-xs text-[#9B9B9B]">{s.reason}</p>
                      {detail?.canCreateRelatedFinding && (
                        <button
                          type="button"
                          disabled={fixBusy}
                          onClick={() =>
                            void sendRelatedFinding(s.sourceUrl, selected.url, s.anchorText)
                          }
                          className="mt-1 text-xs rounded-md border border-[#E8E8E4] px-2 py-1 hover:bg-[#FAFAF8] disabled:opacity-50"
                        >
                          Send to Audit for approval
                        </button>
                      )}
                    </li>
                  ))}
                  {(detail?.suggestions?.length ?? 0) === 0 && (
                    <li className="text-[#9B9B9B]">No extra sources to suggest</li>
                  )}
                </ul>

                {detail?.orphanFindingId && (
                  <Link
                    href={`/dashboard/findings/${detail.orphanFindingId}`}
                    className="inline-block mt-4 text-[#FF6B2C] underline"
                  >
                    Open the Audit finding for this orphan
                  </Link>
                )}
                {fixMsg && <p className="mt-3 text-xs text-[#6B6B6B] leading-5">{fixMsg}</p>}
              </div>
            )}
            </div>
            <div className="flex-shrink-0 border-t border-[#E8E8E4] bg-[#FAFAF8] px-4 py-3">
              <p className="text-[#0F0F0F] font-medium mb-2">Legend</p>
              <ul className="flex flex-col gap-2 text-xs text-[#6B6B6B]">
                <li className="flex items-start gap-2 leading-5">
                  <span className="mt-1.5 inline-block w-2 h-2 rounded-full bg-[#E23D28] shrink-0" />
                  <span>No internal links in</span>
                </li>
                <li className="flex items-start gap-2 leading-5">
                  <span className="mt-1.5 inline-block w-2 h-2 rounded-full bg-[#E08A2A] shrink-0" />
                  <span>More than 3 clicks from home</span>
                </li>
                <li className="flex items-start gap-2 leading-5">
                  <span className="mt-1.5 inline-block w-2 h-2 rounded-full bg-[#C45C6A] shrink-0" />
                  <span>Broken target</span>
                </li>
                <li className="flex items-start gap-2 leading-5">
                  <span className="mt-1.5 inline-block w-2 h-2 rounded-full bg-[#D4A04A] shrink-0" />
                  <span>Redirecting target</span>
                </li>
                <li className="leading-5">Larger dots have more internal links in</li>
                <li className="leading-5">Dashed orange — planned Related reading links</li>
              </ul>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}

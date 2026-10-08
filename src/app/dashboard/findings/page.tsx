'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { getSupabaseClient } from '@/lib/supabase-client'
import { DashboardNav } from '@/components/DashboardNav'
import type {
  FindingsListResponse,
  UiFinding,
} from '@/lib/fix-strategies/findings-ui/client'
import { summarizePartialCoverage } from '@/lib/fix-strategies/findings-ui/crawl/partial-coverage'
import { itemUiStep } from '@/lib/fix-strategies/findings-ui/fix-run/phases'
import { shouldShowFixMySiteButton } from '@/lib/fix-strategies/findings-ui/fix-run/master-gate'
import { whyNotFixedOrFallback } from '@/lib/fix-strategies/findings-ui/owner-copy'
import { readParamFromUrl, writeParamToUrl } from '@/lib/site-selection-url'
import type { User } from '@supabase/supabase-js'

type Site = { id: string; domain: string; brand: string | null }
type CrawlMode = 'connected' | 'detect'

type FixRunItemView = {
  id: string
  findingId: string
  status: string
  failureReason: string | null
  commitSha: string | null
  path: string | null
}

type FixRunView = {
  id: string
  status: string
  phase: string
  branchName: string | null
  prNumber: number | null
  prUrl: string | null
  errorDetail?: string | null
  progressLabel?: string
  canApproveMerge?: boolean
  summary?: {
    total: number
    verifiedLive: number
    failed: number
    previewVerified: number
  } | null
  items: FixRunItemView[]
}

const SITE_QUERY_PARAM = 'site'
const readSiteIdFromUrl = () => readParamFromUrl(SITE_QUERY_PARAM)
const writeSiteIdToUrl = (id: string) => writeParamToUrl(SITE_QUERY_PARAM, id || null)

function severityTone(severity: string | null): string {
  if (severity === 'high' || severity === 'critical') return 'text-red-700 bg-red-50 border-red-100'
  if (severity === 'moderate') return 'text-amber-800 bg-amber-50 border-amber-100'
  if (severity === 'low') return 'text-[#6B6B6B] bg-[#F4F4F2] border-[#E8E8E4]'
  if (severity === 'informational') return 'text-[#6B6B6B] bg-[#F4F4F2] border-[#E8E8E4]'
  return 'text-[#6B6B6B] bg-white border-[#E8E8E4]'
}

function surfaceLabel(f: UiFinding): string {
  switch (f.surfaceClass) {
    case 'auto-fixable':
      return 'Auto-fixable'
    case 'human-review':
      return 'Human review'
    case 'informational':
      return 'Informational'
    case 'report-only':
      return 'Report only'
    case 'finding':
      return 'Finding'
    default:
      return f.surfaceClass
  }
}

function crawlStatusLabel(status: string | null | undefined): string {
  if (!status) return 'No crawl yet'
  if (status === 'partial') return 'Partial coverage'
  if (status === 'complete') return 'Complete'
  if (status === 'running') return 'Running'
  if (status === 'queued') return 'Queued'
  if (status === 'failed') return 'Failed'
  return status
}

/** 5 minutes — matches CRAWL_STALL_UI_MS (kept inline so the client bundle
 *  does not import the crawl server module). */
const CRAWL_STALL_UI_MS = 5 * 60 * 1000

function isCrawlStalled(crawl: {
  status: string | null
  updatedAt?: string | null
}): boolean {
  if (crawl.status !== 'running' && crawl.status !== 'queued') return false
  if (!crawl.updatedAt) return false
  const updated = Date.parse(crawl.updatedAt)
  if (!Number.isFinite(updated)) return false
  return Date.now() - updated > CRAWL_STALL_UI_MS
}

export default function FindingsListPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState('')
  const [mode, setMode] = useState<CrawlMode>('connected')
  const [detectUrl, setDetectUrl] = useState('')
  /** Normalized origin returned by the API after a detect crawl/list. */
  const [detectOrigin, setDetectOrigin] = useState<string | null>(null)
  const [includeInformational, setIncludeInformational] = useState(false)
  const [showLeftAlone, setShowLeftAlone] = useState(false)
  const [data, setData] = useState<FindingsListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [crawling, setCrawling] = useState(false)
  const tickAbort = useRef(false)
  /** Prevents double auto-resume for the same runId. */
  const resumedRunId = useRef<string | null>(null)
  const [fixRun, setFixRun] = useState<FixRunView | null>(null)
  const [fixRunning, setFixRunning] = useState(false)
  const [fixError, setFixError] = useState<string | null>(null)
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null)
  const fixTickAbort = useRef(false)

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
          const initial = (fromUrl && rows.find((r) => r.id === fromUrl)?.id) || rows[0].id
          setSiteId(initial)
          writeSiteIdToUrl(initial)
          setMode('connected')
        } else {
          setMode('detect')
        }
      },
    )
  }, [])

  const loadConnected = useCallback(async (id: string, informational: boolean) => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({ siteId: id })
      if (informational) q.set('informational', '1')
      const res = await fetch(`/api/fix-strategies/findings?${q}`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setData((await res.json()) as FindingsListResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load findings')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDetect = useCallback(
    async (origin: string, informational: boolean) => {
      if (!origin) return
      setLoading(true)
      setError(null)
      try {
        const q = new URLSearchParams({ detectOrigin: origin })
        if (informational) q.set('informational', '1')
        const res = await fetch(`/api/fix-strategies/findings?${q}`)
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        const body = (await res.json()) as FindingsListResponse
        setData(body)
        if (body.origin) setDetectOrigin(body.origin)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load findings')
        setData(null)
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (mode === 'connected' && siteId) {
      void loadConnected(siteId, includeInformational)
    } else if (mode === 'detect' && detectOrigin) {
      void loadDetect(detectOrigin, includeInformational)
    } else if (mode === 'detect' && !detectOrigin) {
      setData(null)
    }
  }, [mode, siteId, detectOrigin, includeInformational, loadConnected, loadDetect])

  // Resume ticking on load when the selected site has a run still in flight
  // (unless it is already past the stall threshold — that needs Retry).
  useEffect(() => {
    const crawl = data?.crawl
    if (!crawl?.runId || crawling) return
    if (crawl.status !== 'running' && crawl.status !== 'queued') return
    if (resumedRunId.current === crawl.runId) return
    if (isCrawlStalled(crawl)) {
      console.info('[crawl] stalled', { runId: crawl.runId })
      return
    }
    void drainCrawlTicks(crawl.runId, { detectOnly: mode === 'detect' })
    // Intentionally omit drainCrawlTicks from deps — stable enough for resume-once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.crawl?.runId, data?.crawl?.status, data?.crawl?.updatedAt, mode, crawling])

  useEffect(() => {
    if (mode !== 'connected' || !siteId) {
      setGithubConnected(null)
      return
    }
    const site = sites.find((s) => s.id === siteId)
    if (!site) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/copilot/site-connection?url=${encodeURIComponent(`https://${site.domain}`)}`,
        )
        if (!res.ok) {
          if (!cancelled) setGithubConnected(false)
          return
        }
        const json = (await res.json()) as {
          connected?: boolean
          cmsType?: string
        }
        if (!cancelled) {
          setGithubConnected(
            !!json.connected && json.cmsType === 'github',
          )
        }
      } catch {
        if (!cancelled) setGithubConnected(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mode, siteId, sites])

  useEffect(() => {
    if (mode !== 'connected' || !siteId) {
      setFixRun(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/fix-strategies/runs?siteId=${encodeURIComponent(siteId)}`,
        )
        if (!res.ok) return
        const json = (await res.json()) as { run?: FixRunView | null }
        if (!cancelled && json.run) setFixRun(json.run)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mode, siteId])

  async function pollFixRun(runId: string) {
    fixTickAbort.current = false
    setFixRunning(true)
    setFixError(null)
    try {
      for (let i = 0; i < 80; i++) {
        if (fixTickAbort.current) break
        const res = await fetch(`/api/fix-strategies/runs/${runId}/tick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'tick' }),
        })
        const json = (await res.json()) as {
          error?: string
          run?: FixRunView
        }
        if (!res.ok || !json.run) {
          throw new Error(json.error || 'Fix run tick failed')
        }
        setFixRun(json.run)
        if (json.run.status === 'failed') {
          setFixError(
            json.run.errorDetail || 'Fix run failed. Please try again.',
          )
          break
        }
        if (
          json.run.phase === 'await_approval' ||
          json.run.phase === 'done' ||
          json.run.status === 'awaiting_approval' ||
          json.run.status === 'complete'
        ) {
          break
        }
        await new Promise((r) => setTimeout(r, 400))
      }
    } catch (e) {
      setFixError(e instanceof Error ? e.message : 'Fix run failed')
    } finally {
      setFixRunning(false)
    }
  }

  async function startFixMySite() {
    if (!siteId || fixRunning) return
    setFixError(null)
    setFixRunning(true)
    try {
      const res = await fetch('/api/fix-strategies/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId }),
      })
      const json = (await res.json()) as {
        error?: string
        run?: FixRunView
      }
      if (!res.ok || !json.run) {
        throw new Error(json.error || 'Could not start fix run')
      }
      setFixRun(json.run)
      setFixRunning(false)
      await pollFixRun(json.run.id)
    } catch (e) {
      setFixError(e instanceof Error ? e.message : 'Could not start fix run')
      setFixRunning(false)
    }
  }

  async function approveAndMerge() {
    if (!fixRun?.id) return
    setFixError(null)
    try {
      const res = await fetch(`/api/fix-strategies/runs/${fixRun.id}/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      const json = (await res.json()) as { error?: string; run?: FixRunView }
      if (!res.ok || !json.run) {
        throw new Error(json.error || 'Approve failed')
      }
      setFixRun(json.run)
      await pollFixRun(json.run.id)
    } catch (e) {
      setFixError(e instanceof Error ? e.message : 'Approve failed')
    }
  }

  const readyFindings =
    data?.findings.filter((f) => f.surfaceClass === 'auto-fixable') ?? []
  const needsYouFindings =
    data?.findings.filter(
      (f) =>
        f.surfaceClass === 'human-review' ||
        f.surfaceClass === 'finding' ||
        f.surfaceClass === 'report-only',
    ) ?? []
  const infoFindings =
    data?.findings.filter((f) => f.surfaceClass === 'informational') ?? []

  async function drainCrawlTicks(runId: string, opts?: { detectOnly?: boolean }) {
    setCrawling(true)
    setError(null)
    tickAbort.current = false
    resumedRunId.current = runId
    try {
      let guard = 0
      while (guard++ < 500 && !tickAbort.current) {
        const tickRes = await fetch('/api/fix-strategies/findings/crawl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            opts?.detectOnly
              ? { mode: 'detect', action: 'tick', runId }
              : { siteId, action: 'tick', runId },
          ),
        })
        const tickBody = (await tickRes.json()) as {
          error?: string
          done?: boolean
          origin?: string
        }
        if (!tickRes.ok) {
          throw new Error(tickBody.error || 'Crawl tick failed')
        }
        if (opts?.detectOnly) {
          if (tickBody.origin) setDetectOrigin(tickBody.origin)
          const origin = tickBody.origin ?? detectOrigin
          if (origin) await loadDetect(origin, includeInformational)
        } else if (siteId) {
          await loadConnected(siteId, includeInformational)
        }
        if (tickBody.done) break
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Crawl failed')
    } finally {
      setCrawling(false)
      if (opts?.detectOnly) {
        const origin = detectOrigin
        if (origin) await loadDetect(origin, includeInformational)
      } else if (siteId) {
        await loadConnected(siteId, includeInformational)
      }
    }
  }

  async function runConnectedCrawl() {
    if (!siteId || crawling) return
    setCrawling(true)
    setError(null)
    tickAbort.current = false
    try {
      const startRes = await fetch('/api/fix-strategies/findings/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, action: 'start' }),
      })
      const startBody = (await startRes.json()) as {
        error?: string
        runId?: string
      }
      if (!startRes.ok || !startBody.runId) {
        throw new Error(startBody.error || 'Failed to start crawl')
      }
      await drainCrawlTicks(startBody.runId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Crawl failed')
      setCrawling(false)
      await loadConnected(siteId, includeInformational)
    }
  }

  async function runDetectCrawl() {
    const url = detectUrl.trim()
    if (!url || crawling) return
    setCrawling(true)
    setError(null)
    tickAbort.current = false
    try {
      const startRes = await fetch('/api/fix-strategies/findings/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'detect', url, action: 'start' }),
      })
      const startBody = (await startRes.json()) as {
        error?: string
        runId?: string
        origin?: string
      }
      if (!startRes.ok || !startBody.runId) {
        throw new Error(startBody.error || 'Failed to start detect crawl')
      }
      if (startBody.origin) setDetectOrigin(startBody.origin)
      await drainCrawlTicks(startBody.runId, { detectOnly: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Detect crawl failed')
      setCrawling(false)
      if (detectOrigin) await loadDetect(detectOrigin, includeInformational)
    }
  }

  async function retryStalledCrawl() {
    const runId = data?.crawl?.runId
    if (!runId || crawling) return
    console.info('[crawl] retry stalled run', { runId })
    await drainCrawlTicks(runId, { detectOnly: mode === 'detect' })
  }

  const crawl = data?.crawl ?? null
  const showPartialBanner =
    Boolean(crawl) &&
    (crawl!.isPartial || crawl!.status === 'partial')
  const uncrawledFound =
    crawl && crawl.urlsFound > crawl.urlsCrawled
      ? crawl.urlsFound - crawl.urlsCrawled
      : 0
  const crawlStalled = Boolean(crawl && isCrawlStalled(crawl))

  const canRun =
    mode === 'connected'
      ? Boolean(siteId) && !crawling
      : Boolean(detectUrl.trim()) && !crawling

  return (
    <div
      className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden"
      style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}
    >
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">Audit</h1>
            <p className="text-[#6B6B6B] mt-1">
              Issues found on your site, and which ones SEORANKO can fix safely.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex rounded-md border border-[#E8E8E4] bg-white overflow-hidden text-sm">
              <button
                type="button"
                disabled={crawling}
                onClick={() => setMode('connected')}
                className={`px-3 py-1.5 ${
                  mode === 'connected'
                    ? 'bg-[#0F0F0F] text-white'
                    : 'text-[#6B6B6B] hover:bg-[#F4F4F2]'
                } disabled:opacity-50`}
              >
                Connected site
              </button>
              <button
                type="button"
                disabled={crawling}
                onClick={() => setMode('detect')}
                className={`px-3 py-1.5 border-l border-[#E8E8E4] ${
                  mode === 'detect'
                    ? 'bg-[#0F0F0F] text-white'
                    : 'text-[#6B6B6B] hover:bg-[#F4F4F2]'
                } disabled:opacity-50`}
              >
                Public URL
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 mb-6">
            {mode === 'connected' ? (
              <label className="text-sm text-[#6B6B6B]">
                Site{' '}
                <select
                  className="ml-1 rounded-md border border-[#E8E8E4] bg-white px-2 py-1.5 text-[#0F0F0F]"
                  value={siteId}
                  onChange={(e) => {
                    setSiteId(e.target.value)
                    writeSiteIdToUrl(e.target.value)
                  }}
                  disabled={crawling}
                >
                  {sites.length === 0 && (
                    <option value="">No connected sites</option>
                  )}
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.brand || s.domain}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="text-sm text-[#6B6B6B] flex-1 min-w-[16rem]">
                Public URL
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://example.com"
                  className="mt-1 block w-full rounded-md border border-[#E8E8E4] bg-white px-2 py-1.5 text-[#0F0F0F]"
                  value={detectUrl}
                  onChange={(e) => setDetectUrl(e.target.value)}
                  disabled={crawling}
                />
                <span className="block mt-1 text-xs text-[#9B9B9B]">
                  Detection only — no connection, repo, or credentials stored.
                </span>
              </label>
            )}
            <button
              type="button"
              onClick={() =>
                void (mode === 'detect' ? runDetectCrawl() : runConnectedCrawl())
              }
              disabled={!canRun}
              className="rounded-md bg-[#FF6B2C] text-white text-sm px-3 py-1.5 disabled:opacity-50"
            >
              {crawling
                ? 'Crawling…'
                : mode === 'detect'
                  ? 'Detect'
                  : 'Run crawl'}
            </button>
          </div>

          {crawlStalled && crawl?.runId && (
            <div className="mb-4 rounded-md border border-[#E8C4B8] bg-[#FFF6F2] px-3 py-2 text-sm text-[#0F0F0F] flex flex-wrap items-center gap-3">
              <span>Crawl stalled — no tick for 5+ minutes.</span>
              <button
                type="button"
                onClick={() => void retryStalledCrawl()}
                disabled={crawling}
                className="rounded-md bg-[#0F0F0F] text-white text-sm px-3 py-1 disabled:opacity-50"
              >
                Retry
              </button>
            </div>
          )}

          {crawl && (
            <div className="mb-4 text-sm text-[#6B6B6B] flex flex-wrap gap-2 items-center">
              <span className="px-2.5 py-1 rounded-md bg-white border border-[#E8E8E4]">
                Status:{' '}
                {crawlStalled ? 'Crawl stalled' : crawlStatusLabel(crawl.status)}
              </span>
              <span className="px-2.5 py-1 rounded-md bg-white border border-[#E8E8E4]">
                {crawl.urlsCrawled} crawled · {crawl.urlsFound} found
                {crawl.urlsDiscovered < crawl.urlsFound
                  ? ` · ${crawl.urlsDiscovered} enqueued`
                  : ''}
              </span>
              <span
                className="px-2.5 py-1 rounded-md bg-white border border-[#E8E8E4]"
                title="Headless render coverage — only pages where raw HTML lacked links/content"
              >
                {crawl.pagesRendered ?? 0} rendered
                {(crawl.pagesRenderFailed ?? 0) > 0
                  ? ` · ${crawl.pagesRenderFailed} render failed`
                  : ''}
                {(crawl.totalRenderTimeMs ?? 0) > 0
                  ? ` · ${Math.round((crawl.totalRenderTimeMs ?? 0) / 100) / 10}s render`
                  : ''}
              </span>
              {crawl.urlCap != null && (
                <span className="px-2.5 py-1 rounded-md bg-white border border-[#E8E8E4]">
                  Cap {crawl.urlCap}
                </span>
              )}
              <span className="px-2.5 py-1 rounded-md bg-white border border-[#E8E8E4]">
                Chunk {crawl.chunkSize}
              </span>
              {mode === 'detect' && (
                <span className="px-2.5 py-1 rounded-md border border-dashed border-[#E8E8E4] text-[#9B9B9B]">
                  Detect-only
                </span>
              )}
            </div>
          )}

          {showPartialBanner && crawl && (
            <div className="mb-6 rounded-[10px] border border-amber-200 bg-amber-50 text-amber-950 px-4 py-3 text-sm">
              {(() => {
                const summary = summarizePartialCoverage(crawl.coverageNotes, {
                  urlsFound: crawl.urlsFound,
                  urlsCrawled: crawl.urlsCrawled,
                  urlsFailed: crawl.urlsFailed,
                  urlsClientOnly: crawl.urlsClientOnly,
                })
                if (summary.isPlanLimit) {
                  return (
                    <>
                      <p className="font-medium">{summary.headline}</p>
                      <p className="mt-1 text-amber-900/80">
                        This run stopped as partial because of your plan&apos;s
                        per-crawl page limit — not a silent truncation. Findings
                        below reflect only URLs this run assessed.
                      </p>
                      <p className="mt-2">
                        <Link
                          href="/dashboard/billing"
                          className="font-medium text-[#FF6B2C] hover:underline"
                        >
                          Upgrade for a higher page limit →
                        </Link>
                      </p>
                    </>
                  )
                }
                return (
                  <>
                    <p className="font-medium">{summary.headline}</p>
                    <p className="mt-1 text-amber-900/80">
                      Findings below reflect only URLs this run assessed
                      (including fetch failures). Pages never reached cannot
                      resolve open findings.
                      {uncrawledFound > 0 && summary.buckets.length === 0 ? (
                        <>
                          {' '}
                          {uncrawledFound} of {crawl.urlsFound} discovered URL
                          {crawl.urlsFound === 1 ? '' : 's'} were not crawled
                          {crawl.urlCap != null ? ` (cap ${crawl.urlCap})` : ''}.
                        </>
                      ) : null}
                    </p>
                    {summary.buckets.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 space-y-1 text-amber-900/80">
                        {summary.buckets.map((b) => (
                          <li key={b.code}>
                            <span className="font-medium">{b.label}</span>
                            {b.urls.length > 0 ? (
                              <ul className="mt-0.5 list-none pl-0 space-y-0.5 font-mono text-xs">
                                {b.urls.map((u) => (
                                  <li key={u} className="break-all">
                                    {u}
                                    {b.details.length === 1
                                      ? ` — ${b.details[0]}`
                                      : ''}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-amber-900/70">
                                {' '}
                                — {b.details[0] ?? b.code}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          {data?.whatChanged && (
            <div className="mb-6 rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-[#9B9B9B] mb-1">
                What changed
              </p>
              <p className="font-medium text-[#0F0F0F]">
                {data.whatChanged.summaryLine}
              </p>
              {data.whatChanged.regressedFindings.length > 0 && (
                <ul className="mt-2 space-y-1 text-[#6B6B6B]">
                  {data.whatChanged.regressedFindings.map((f) => (
                    <li key={f.id}>
                      <Link
                        href={`/dashboard/findings/${f.id}`}
                        className="text-[#FF6B2C] hover:underline font-mono text-xs"
                      >
                        REGRESSION · {f.verdict}
                      </Link>
                      {f.pageUrl ? (
                        <span className="ml-2 font-mono text-xs break-all">
                          {f.pageUrl}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {data.whatChanged.newFindings.length > 0 && (
                <ul className="mt-2 space-y-1 text-[#6B6B6B]">
                  {data.whatChanged.newFindings.slice(0, 5).map((f) => (
                    <li key={f.id}>
                      <Link
                        href={`/dashboard/findings/${f.id}`}
                        className="hover:underline font-mono text-xs"
                      >
                        New · {f.verdict}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {data.whatChanged.resolvedFindings.length > 0 && (
                <p className="mt-2 text-[#6B6B6B]">
                  {data.whatChanged.resolvedFindings.length} resolved since the
                  previous crawl.
                </p>
              )}
            </div>
          )}

          {data && (
            <div className="flex flex-wrap items-center gap-3 mb-6 text-sm text-[#6B6B6B]">
              <span className="px-2.5 py-1 rounded-md bg-white border border-[#E8E8E4]">
                {data.counts.actionable} actionable
              </span>
              <span className="px-2.5 py-1 rounded-md bg-white border border-[#E8E8E4]">
                {data.counts.informational} informational
              </span>
              <span
                className="px-2.5 py-1 rounded-md bg-[#F4F4F2] border border-[#E8E8E4] text-[#9B9B9B]"
                title="Internal audit trail — not shown in this list"
              >
                {data.counts.internal} internal (hidden)
              </span>
              {data.origin && (
                <span className="px-2.5 py-1 rounded-md border border-dashed border-[#E8E8E4] text-[#9B9B9B]">
                  {data.origin}
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-4 mb-6">
            <label className="flex items-center gap-2 text-sm text-[#6B6B6B] cursor-pointer select-none">
              <input
                type="checkbox"
                className="rounded border-[#E8E8E4] text-[#FF6B2C] focus:ring-[#FF6B2C]"
                checked={includeInformational}
                onChange={(e) => setIncludeInformational(e.target.checked)}
              />
              Show informational
            </label>
            <label className="flex items-center gap-2 text-sm text-[#6B6B6B] cursor-pointer select-none">
              <input
                type="checkbox"
                className="rounded border-[#E8E8E4] text-[#FF6B2C] focus:ring-[#FF6B2C]"
                checked={showLeftAlone}
                onChange={(e) => setShowLeftAlone(e.target.checked)}
              />
              What SEORANKO checked and left alone
            </label>
          </div>

          {showLeftAlone && data && (
            <section className="mb-8 rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-4">
              <h2 className="text-sm font-medium text-[#0F0F0F] mb-1">
                Checked and left alone
              </h2>
              <p className="text-sm text-[#6B6B6B] mb-4">
                Suppress, route, skip, and ok reasons from this crawl. These
                never appear in the findings list.
              </p>
              {(data.leftAlone ?? []).length === 0 ? (
                <p className="text-sm text-[#9B9B9B]">
                  No left-alone reasons attached to the findings in this view.
                </p>
              ) : (
                <ul className="space-y-3">
                  {(data.leftAlone ?? []).map((row) => (
                    <li
                      key={row.verdict}
                      className="rounded-md border border-[#E8E8E4] bg-[#F4F4F2] px-3 py-2"
                    >
                      <p className="text-[#0F0F0F] leading-snug">
                        {row.whyNotFixed}
                      </p>
                      <p className="mt-1 font-mono text-xs text-[#6B6B6B]">
                        {row.verdict}
                        {' · '}
                        {row.count}×
                        {row.topicIds.length > 0
                          ? ` · topic ${row.topicIds.join(', ')}`
                          : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-20 rounded-[10px] bg-white border border-[#E8E8E4] animate-pulse"
                />
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-[10px] border border-red-100 bg-red-50 text-red-800 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {!loading && !error && data && data.findings.length === 0 && (
            <div className="rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-8 text-center text-[#6B6B6B]">
              {crawl
                ? 'No findings in this view.'
                : mode === 'detect'
                  ? 'No crawl yet. Enter a public URL and run Detect.'
                  : 'No crawl yet. Connect a site and run a crawl, or switch to Public URL.'}
            </div>
          )}

          {!loading && !error && !data && mode === 'detect' && !detectOrigin && (
            <div className="rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-8 text-center text-[#6B6B6B]">
              Enter a public URL to run a detection-only crawl. No site
              connection is created.
            </div>
          )}

          {!loading && data && data.findings.length > 0 && (
            <div className="space-y-8">
              {mode === 'connected' &&
                shouldShowFixMySiteButton(data.canRunFixAgent === true) && (
                <div
                  data-testid="fix-my-site"
                  className="rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-[#0F0F0F]">Fix my site</p>
                      <p className="text-xs text-[#6B6B6B] mt-0.5">
                        One pull request with a commit per auto-fixable finding.
                        Deterministic transforms only — no model-generated edits.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void startFixMySite()}
                      disabled={
                        fixRunning ||
                        readyFindings.length === 0 ||
                        githubConnected === false
                      }
                      className="px-4 py-2 rounded-lg bg-[#FF6B2C] text-white text-sm font-medium disabled:opacity-50"
                    >
                      {fixRunning
                        ? 'Fixing…'
                        : `Fix my site (${readyFindings.length} fix${readyFindings.length === 1 ? '' : 'es'})`}
                    </button>
                  </div>
                  {githubConnected === false && (
                    <p className="text-xs text-amber-800 mt-2">
                      Connect GitHub for this site in Settings before Fix my site can open a PR.
                    </p>
                  )}
                  {readyFindings.length === 0 && githubConnected !== false && (
                    <p className="text-xs text-[#9B9B9B] mt-2">
                      No auto-fixable findings ready — nothing to batch.
                    </p>
                  )}
                  {fixError && (
                    <p className="text-xs text-red-700 mt-2">{fixError}</p>
                  )}
                  {fixRun && (
                    <div className="mt-4 border-t border-[#F5F4F1] pt-3 space-y-2">
                      <p className="text-xs font-medium text-[#0F0F0F]">
                        {fixRun.progressLabel || fixRun.phase}
                      </p>
                      <ul className="space-y-1">
                        {fixRun.items.map((item) => (
                          <li
                            key={item.id}
                            className="text-xs text-[#6B6B6B] flex flex-wrap gap-2"
                          >
                            <span className="font-mono">{item.findingId.slice(0, 8)}</span>
                            <span>
                              {itemUiStep(
                                item.status as Parameters<typeof itemUiStep>[0],
                              )}
                            </span>
                            {item.failureReason && (
                              <span className="text-red-700">— {item.failureReason}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {fixRun.canApproveMerge && (
                        <button
                          type="button"
                          onClick={() => void approveAndMerge()}
                          className="mt-2 px-3 py-1.5 rounded-lg bg-[#0F0F0F] text-white text-xs"
                        >
                          Approve and merge
                        </button>
                      )}
                      {fixRun.phase === 'done' && fixRun.summary && (
                        <p className="text-xs text-[#6B6B6B] mt-2">
                          Done — {fixRun.summary.verifiedLive} verified live
                          {fixRun.summary.failed ? `, ${fixRun.summary.failed} failed` : ''}
                          {fixRun.prUrl ? (
                            <>
                              {' · '}
                              <a
                                href={fixRun.prUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#FF6B2C] underline"
                              >
                                PR #{fixRun.prNumber}
                              </a>
                            </>
                          ) : null}
                        </p>
                      )}
                      {fixRun.prUrl && fixRun.phase !== 'done' && (
                        <a
                          href={fixRun.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[#FF6B2C] underline"
                        >
                          Open PR #{fixRun.prNumber}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              {(
                [
                  { key: 'ready', title: `Ready to fix (${readyFindings.length})`, rows: readyFindings },
                  { key: 'needs', title: `Needs you (${needsYouFindings.length})`, rows: needsYouFindings },
                  { key: 'info', title: `For information (${infoFindings.length})`, rows: infoFindings },
                ] as const
              ).map((group) =>
                group.rows.length === 0 ? null : (
                  <section key={group.key}>
                    <h2 className="text-sm font-medium text-[#0F0F0F] mb-3">{group.title}</h2>
                    <ul className="space-y-3">
                      {group.rows.map((f) => (
                        <li key={f.id}>
                          <Link
                            href={`/dashboard/findings/${f.id}`}
                            className="block rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-4 hover:border-[#FF6B2C]/40 transition-colors"
                          >
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className={`text-xs px-2 py-0.5 rounded border ${severityTone(f.severity)}`}>
                                {f.severity ?? '—'}
                              </span>
                              <span className="text-xs px-2 py-0.5 rounded border border-[#E8E8E4] text-[#6B6B6B]">
                                {surfaceLabel(f)}
                              </span>
                              <span className="text-xs text-[#9B9B9B]">Topic {f.topicId}</span>
                            </div>
                            {f.ownerPlainEnglish && (
                              <p className="text-[#0F0F0F] leading-snug mb-1">{f.ownerPlainEnglish}</p>
                            )}
                            {(f.whyNotAutoFixed ||
                              group.key === 'needs') && (
                              <p className="text-xs text-amber-900 mt-2 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5">
                                {f.whyNotAutoFixed ??
                                  whyNotFixedOrFallback(f.verdict)}
                              </p>
                            )}
                            {f.pageUrl && (
                              <p className="text-sm text-[#6B6B6B] mt-1 truncate">{f.pageUrl}</p>
                            )}
                            <p className="text-sm text-[#6B6B6B] mt-2 line-clamp-2">{f.detail}</p>
                            <details
                              className="mt-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <summary className="text-xs text-[#9B9B9B] cursor-pointer select-none">
                                Details
                              </summary>
                              <p className="font-mono text-xs text-[#6B6B6B] leading-snug mt-1">
                                {f.verdict}
                              </p>
                            </details>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ),
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

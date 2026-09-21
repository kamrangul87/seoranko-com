'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import { DashboardNav } from '@/components/DashboardNav'
import type { FindingsListResponse, UiFinding } from '@/lib/fix-strategies/findings-ui/client'
import type { User } from '@supabase/supabase-js'

type Site = { id: string; domain: string; brand: string | null }

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

export default function FindingsListPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState('')
  const [includeInformational, setIncludeInformational] = useState(false)
  const [data, setData] = useState<FindingsListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [crawling, setCrawling] = useState(false)
  const tickAbort = useRef(false)

  useEffect(() => {
    const supabase = createClient()
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
        if (rows[0]) setSiteId(rows[0].id)
      },
    )
  }, [])

  const load = useCallback(async (id: string, informational: boolean) => {
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

  useEffect(() => {
    if (siteId) void load(siteId, includeInformational)
  }, [siteId, includeInformational, load])

  async function runCrawl() {
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

      let guard = 0
      while (guard++ < 500 && !tickAbort.current) {
        const tickRes = await fetch('/api/fix-strategies/findings/crawl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteId,
            action: 'tick',
            runId: startBody.runId,
          }),
        })
        const tickBody = (await tickRes.json()) as {
          error?: string
          done?: boolean
        }
        if (!tickRes.ok) {
          throw new Error(tickBody.error || 'Crawl tick failed')
        }
        await load(siteId, includeInformational)
        if (tickBody.done) break
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Crawl failed')
    } finally {
      setCrawling(false)
      await load(siteId, includeInformational)
    }
  }

  const crawl = data?.crawl ?? null
  const showPartialBanner =
    crawl &&
    (crawl.isPartial || crawl.status === 'partial') &&
    (crawl.status === 'partial' ||
      crawl.status === 'complete' ||
      crawl.status === 'failed')

  return (
    <div
      className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden"
      style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}
    >
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <div className="mb-6">
            <p className="text-xs uppercase tracking-wide text-[#9B9B9B] mb-1">
              Fix strategies
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Findings</h1>
            <p className="text-[#6B6B6B] mt-1">
              Live crawl → detectors → persisted findings. Internal evidence is
              stored but never listed here.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-6">
            <label className="text-sm text-[#6B6B6B]">
              Site{' '}
              <select
                className="ml-1 rounded-md border border-[#E8E8E4] bg-white px-2 py-1.5 text-[#0F0F0F]"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                disabled={crawling}
              >
                {sites.length === 0 && <option value="">No connected sites</option>}
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.brand || s.domain}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void runCrawl()}
              disabled={!siteId || crawling}
              className="rounded-md bg-[#FF6B2C] text-white text-sm px-3 py-1.5 disabled:opacity-50"
            >
              {crawling ? 'Crawling…' : 'Run crawl'}
            </button>
          </div>

          {crawl && (
            <div className="mb-4 text-sm text-[#6B6B6B] flex flex-wrap gap-2 items-center">
              <span className="px-2.5 py-1 rounded-md bg-white border border-[#E8E8E4]">
                Status: {crawlStatusLabel(crawl.status)}
              </span>
              <span className="px-2.5 py-1 rounded-md bg-white border border-[#E8E8E4]">
                {crawl.urlsCrawled}/{crawl.urlsDiscovered} URLs
              </span>
              <span className="px-2.5 py-1 rounded-md bg-white border border-[#E8E8E4]">
                Chunk {crawl.chunkSize}
              </span>
            </div>
          )}

          {showPartialBanner && (
            <div className="mb-6 rounded-[10px] border border-amber-200 bg-amber-50 text-amber-950 px-4 py-3 text-sm">
              <p className="font-medium">Partial crawl coverage</p>
              <p className="mt-1 text-amber-900/80">
                This run did not cover the full site. Findings below reflect
                only the URLs successfully crawled — do not treat this as a
                complete audit.
              </p>
              {crawl.coverageNotes.length > 0 && (
                <ul className="mt-2 list-disc pl-5 space-y-0.5 text-amber-900/70">
                  {crawl.coverageNotes.slice(0, 8).map((n, i) => (
                    <li key={`${n.code}-${i}`}>
                      {n.code}: {n.detail}
                    </li>
                  ))}
                </ul>
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

          <label className="flex items-center gap-2 mb-6 text-sm text-[#6B6B6B] cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-[#E8E8E4] text-[#FF6B2C] focus:ring-[#FF6B2C]"
              checked={includeInformational}
              onChange={(e) => setIncludeInformational(e.target.checked)}
            />
            Show informational
          </label>

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
                : 'No crawl yet. Connect a site and run a crawl.'}
            </div>
          )}

          {!loading && data && data.findings.length > 0 && (
            <ul className="space-y-3">
              {data.findings.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/dashboard/findings/${f.id}`}
                    className="block rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-4 hover:border-[#FF6B2C]/40 transition-colors"
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded border ${severityTone(f.severity)}`}
                      >
                        {f.severity ?? '—'}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded border border-[#E8E8E4] text-[#6B6B6B]">
                        {surfaceLabel(f)}
                      </span>
                      <span className="text-xs text-[#9B9B9B]">
                        Topic {f.topicId}
                      </span>
                    </div>
                    <p className="font-medium text-[#0F0F0F] leading-snug">
                      {f.verdict}
                    </p>
                    {f.rolledUp && f.declarationSite ? (
                      <p className="text-sm text-[#6B6B6B] mt-1">
                        Component{' '}
                        <span className="font-mono text-[#0F0F0F]">
                          {f.declarationSite}
                        </span>
                        {' · '}
                        {f.affectedUrlCount} URLs affected
                      </p>
                    ) : (
                      f.pageUrl && (
                        <p className="text-sm text-[#6B6B6B] mt-1 truncate">
                          {f.pageUrl}
                        </p>
                      )
                    )}
                    <p className="text-sm text-[#6B6B6B] mt-2 line-clamp-2">
                      {f.detail}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  )
}

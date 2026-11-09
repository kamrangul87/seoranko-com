'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { getSupabaseClient } from '@/lib/supabase-client'
import { DashboardNav } from '@/components/DashboardNav'
import { InternalLinkMapCanvas, type MapView } from '@/components/internal-link-map/InternalLinkMapCanvas'
import { CRAWL_STATUS_POLL_MS, crawlProgressKind } from '@/lib/fix-strategies/findings-ui/crawl/crawl-progress-ui'
import { readParamFromUrl, writeParamToUrl } from '@/lib/site-selection-url'
import type { LinkMapResponse } from '@/lib/internal-link-map/client-types'
import type { User } from '@supabase/supabase-js'

type Site = { id: string; domain: string; brand: string | null }

const SITE_QUERY_PARAM = 'site'
const readSiteIdFromUrl = () => readParamFromUrl(SITE_QUERY_PARAM)
const writeSiteIdToUrl = (id: string) => writeParamToUrl(SITE_QUERY_PARAM, id || null)

function fmtDepth(n: number | null): string {
  if (n == null) return '—'
  return n.toFixed(1)
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

  useEffect(() => {
    if (siteId) void load(siteId, selectedUrl)
  }, [siteId, selectedUrl, load])

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
      setFixMsg('Queued on Audit — open it and approve a PR. Nothing was changed on the site.')
    } catch (e) {
      setFixMsg(e instanceof Error ? e.message : 'Could not queue the suggestion')
    } finally {
      setFixBusy(false)
    }
  }

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
                />
              </div>
            )}
          </div>

          <aside className="w-80 flex-shrink-0 border-l border-[#E8E8E4] bg-white overflow-y-auto p-4 text-sm">
            <p className="text-[#0F0F0F] font-medium mb-2">Legend</p>
            <ul className="space-y-1 text-[#6B6B6B] mb-5">
              <li><span className="inline-block w-2 h-2 rounded-full bg-[#E23D28] mr-2" />No internal links in</li>
              <li><span className="inline-block w-2 h-2 rounded-full bg-[#E08A2A] mr-2" />More than 3 clicks from home</li>
              <li><span className="inline-block w-2 h-2 rounded-full bg-[#C45C6A] mr-2" />Broken target</li>
              <li><span className="inline-block w-2 h-2 rounded-full bg-[#D4A04A] mr-2" />Redirecting target</li>
              <li>Larger dots have more internal links in</li>
            </ul>

            {!selected && (
              <p className="text-[#9B9B9B]">Click a page on the map to see what links in and out.</p>
            )}
            {selected && (
              <div>
                <p className="font-medium text-[#0F0F0F] break-all">{selected.path}</p>
                <p className="text-xs text-[#9B9B9B] mt-1 break-all">{selected.url}</p>
                <p className="mt-2 text-[#6B6B6B]">
                  {selected.inlinks} in · {selected.outlinks} out
                  {selected.depth != null ? ` · ${selected.depth} clicks from home` : ' · not reached from home'}
                </p>

                <p className="mt-4 font-medium text-[#0F0F0F]">Links in</p>
                <ul className="mt-1 space-y-1">
                  {(detail?.inlinks ?? []).slice(0, 12).map((e) => (
                    <li key={`${e.source}|${e.anchor}`} className="text-[#6B6B6B]">
                      <button
                        type="button"
                        className="text-left underline decoration-[#E8E8E4] hover:text-[#0F0F0F]"
                        onClick={() => setSelectedUrl(e.source)}
                      >
                        {e.source.replace(/^https?:\/\/[^/]+/, '') || '/'}
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
                        className="text-left underline decoration-[#E8E8E4] hover:text-[#0F0F0F]"
                        onClick={() => setSelectedUrl(e.target)}
                      >
                        {e.target.replace(/^https?:\/\/[^/]+/, '') || '/'}
                      </button>
                      {e.broken ? <span className="text-[#E23D28]"> broken</span> : null}
                      {e.redirect ? <span className="text-[#E08A2A]"> redirect</span> : null}
                    </li>
                  ))}
                  {(detail?.outlinks?.length ?? 0) === 0 && (
                    <li className="text-[#9B9B9B]">None yet</li>
                  )}
                </ul>

                <p className="mt-4 font-medium text-[#0F0F0F]">Pages that should link here</p>
                <ul className="mt-1 space-y-2">
                  {(detail?.suggestions ?? []).map((s) => (
                    <li key={s.sourceUrl} className="text-[#6B6B6B]">
                      <p className="break-all">{s.sourceUrl.replace(/^https?:\/\/[^/]+/, '') || '/'}</p>
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
                {fixMsg && <p className="mt-3 text-xs text-[#6B6B6B]">{fixMsg}</p>}
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  )
}

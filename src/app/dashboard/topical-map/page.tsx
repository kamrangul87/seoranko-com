'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase-client'
import { DashboardNav } from '@/components/DashboardNav'
import { CannibalisationPanel } from '@/components/CannibalisationPanel'

function Loader2({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function MapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  )
}

function RefreshCw({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

// §10 item 13 / §5 — this page is now the "Plan" nav screen (Station 2).
export default function PlanPage() {
  const [section, setSection] = useState<'topical-map' | 'cannibalisation'>('topical-map')

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 pt-8">
          <div className="flex gap-3 mb-2">
            {(['topical-map', 'cannibalisation'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`text-sm px-4 py-1.5 rounded-full font-medium transition-colors ${
                  section === s
                    ? 'bg-[#FF6B2C] text-white'
                    : 'bg-white border border-[#E8E8E4] text-[#6B6B6B] hover:text-[#0F0F0F]'
                }`}
              >
                {s === 'topical-map' ? 'Topical Map' : 'Cannibalisation'}
              </button>
            ))}
          </div>
        </div>
        {section === 'topical-map' ? <TopicalMapContent /> : (
          <div className="max-w-3xl mx-auto px-4 py-8">
            <CannibalisationPanel />
          </div>
        )}
      </main>
    </div>
  )
}

async function getBearerHeaders(): Promise<HeadersInit | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return null
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }
}

function TopicalMapContent() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [addingLinkFor, setAddingLinkFor] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadExisting() {
      try {
        const headers = await getBearerHeaders()
        if (!headers) { setInitialLoading(false); return }
        const res = await fetch('/api/topical-map', {
          headers,
          credentials: 'include'
        })
        const data = await res.json()
        if (!cancelled && data.success && data.result) setResult(data.result)
      } catch {
        // Silent — falls through to empty state
      } finally {
        if (!cancelled) setInitialLoading(false)
      }
    }
    loadExisting()
    return () => { cancelled = true }
  }, [])

  async function generateMap() {
    setLoading(true)
    setError(null)
    try {
      const headers = await getBearerHeaders()
      if (!headers) {
        setError('Not logged in — please refresh the page')
        setLoading(false)
        return
      }

      const res = await fetch('/api/topical-map', {
        method: 'POST',
        headers,
        credentials: 'include'
      })
      const data = await res.json().catch(() => ({}))
      if (data.success) setResult(data.result)
      else setError(data.error || 'Failed to build map')
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  async function persistMap(next: any) {
    setSaving(true)
    setError(null)
    try {
      const headers = await getBearerHeaders()
      if (!headers) {
        setError('Not logged in — please refresh the page')
        return
      }
      const res = await fetch('/api/topical-map', {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify({ map_data: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'Could not save map changes')
        return
      }
      setResult(data.result || next)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1500)
    } catch {
      setError('Could not copy — browser blocked clipboard access')
    }
  }

  function writeIdea(topic: string) {
    router.push(`/dashboard/keywords?q=${encodeURIComponent(topic)}`)
  }

  function dismissGap(clusterIndex: number, topic: string) {
    if (!result) return
    const next = {
      ...result,
      clusters: result.clusters.map((c: any, i: number) =>
        i !== clusterIndex
          ? c
          : {
              ...c,
              missingSubtopics: (c.missingSubtopics || []).filter((t: string) => t !== topic),
            }
      ),
    }
    void persistMap(next)
  }

  function deleteCluster(clusterIndex: number) {
    if (!result) return
    const cluster = result.clusters[clusterIndex]
    if (!cluster) return
    if (!confirm(`Remove the “${cluster.pillarTopic}” cluster from this map? You can rebuild the map later.`)) return
    const next = {
      ...result,
      clusters: result.clusters.filter((_: any, i: number) => i !== clusterIndex),
      topRecommendation: result.clusters.length <= 1
        ? 'Rebuild the map after writing more articles.'
        : result.topRecommendation,
    }
    void persistMap(next)
  }

  async function addInternalLink(sourcePage: any, targetPage: any) {
    if (!sourcePage.brand || sourcePage.brand !== targetPage.brand || !targetPage.url) return
    setAddingLinkFor(sourcePage.articleId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return

      const { data: existing } = await supabase
        .from('internal_link_registry')
        .select('id')
        .eq('user_id', session.user.id)
        .eq('brand', targetPage.brand)
        .eq('page_url', targetPage.url)
        .eq('is_active', true)
        .maybeSingle()

      if (!existing) {
        let siteUrl = ''
        try { siteUrl = new URL(targetPage.url).origin } catch { /* leave blank */ }
        await supabase.from('internal_link_registry').insert({
          user_id: session.user.id,
          brand: targetPage.brand,
          site_url: siteUrl,
          page_url: targetPage.url,
          page_title: targetPage.title,
          topic_tags: [],
          anchor_text: targetPage.title,
          is_active: true,
        })
      }

      const instruction = `Add an internal link to "${targetPage.title}" (${targetPage.url}) using anchor text "${targetPage.title}" — these two articles are in the same topic cluster and should link to each other.`
      router.push(`/dashboard/improve?articleId=${encodeURIComponent(sourcePage.articleId)}&instruction=${encodeURIComponent(instruction)}`)
    } finally {
      setAddingLinkFor(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Topical Map</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Groups your SEORANKO articles into topic clusters, highlights content gaps, and suggests what to write next.
          </p>
        </div>
        <button
          onClick={generateMap}
          disabled={loading || saving}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-xl disabled:opacity-50 transition-colors flex-shrink-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {loading ? 'Building map...' : result ? 'Rebuild map' : 'Build topical map'}
        </button>
      </div>

      <div className="text-xs text-gray-500 bg-white border border-gray-200 rounded-xl px-4 py-3 space-y-1">
        <p><span className="font-medium text-gray-700">How to use:</span> purple chips are missing subtopics — Copy the idea, Write it in Keywords, or Dismiss if it is not relevant.</p>
        <p>Delete removes a whole cluster from this saved map (does not delete articles). Rebuild regenerates clusters from your current library.</p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-sm text-red-700 break-words">{error}</div>
      )}

      {saving && (
        <p className="text-xs text-gray-400">Saving map changes…</p>
      )}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-gray-800">{result.clusters.length}</div>
              <div className="text-xs text-gray-500 mt-1">Topic clusters</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-amber-600">{result.orphanArticles.length}</div>
              <div className="text-xs text-gray-500 mt-1">Orphaned articles</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-purple-600">
                {result.clusters.flatMap((c: any) => c.missingSubtopics || []).length}
              </div>
              <div className="text-xs text-gray-500 mt-1">Missing subtopics</div>
            </div>
          </div>

          <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-orange-800 mb-1">Top recommendation</p>
                <p className="text-sm text-orange-700">{result.topRecommendation}</p>
              </div>
              <button
                onClick={() => copyText('rec', result.topRecommendation || '')}
                className="text-xs text-orange-700 hover:text-orange-900 flex-shrink-0"
              >
                {copiedKey === 'rec' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {result.orphanArticles?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-medium text-amber-800 mb-2">Orphaned articles</p>
              <ul className="space-y-1">
                {result.orphanArticles.map((idOrTitle: string, i: number) => (
                  <li key={i} className="text-xs text-amber-700 truncate">• {idOrTitle}</li>
                ))}
              </ul>
            </div>
          )}

          {result.clusters.map((cluster: any, i: number) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900">{cluster.pillarTopic}</h3>
                  <p className="text-xs text-gray-400 truncate">Keyword: {cluster.pillarKeyword}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      onClick={() => copyText(`kw-${i}`, cluster.pillarKeyword || cluster.pillarTopic || '')}
                      className="text-xs text-gray-500 hover:text-orange-600"
                    >
                      {copiedKey === `kw-${i}` ? 'Copied' : 'Copy keyword'}
                    </button>
                    <button
                      onClick={() => writeIdea(cluster.pillarKeyword || cluster.pillarTopic)}
                      className="text-xs text-orange-600 hover:text-orange-700 font-medium"
                    >
                      Research in Keywords →
                    </button>
                    <button
                      onClick={() => deleteCluster(i)}
                      disabled={saving}
                      className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                    >
                      Delete cluster
                    </button>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-2xl font-bold ${cluster.topicalAuthorityScore >= 70 ? 'text-green-600' : cluster.topicalAuthorityScore >= 40 ? 'text-amber-600' : 'text-red-500'}`}>
                    {cluster.topicalAuthorityScore}
                  </div>
                  <div className="text-xs text-gray-400">Authority score</div>
                </div>
              </div>

              <div className="space-y-1.5">
                {(() => {
                  const pillarPage = cluster.clusterPages.find((p: any) => p.subtopic === 'Pillar page')
                  return cluster.clusterPages.map((page: any, j: number) => {
                    const canSuggestLink =
                      pillarPage && page.subtopic !== 'Pillar page' && !page.linksToPillar &&
                      page.brand && page.brand === pillarPage.brand && pillarPage.url
                    return (
                      <div key={j} className={`flex items-center gap-2 text-xs p-2 rounded-lg ${page.isOrphan ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${page.subtopic === 'Pillar page' ? 'bg-purple-500' : page.linksToPillar ? 'bg-green-500' : 'bg-amber-400'}`} />
                        <span className="text-gray-700 flex-1 truncate">{page.title}</span>
                        {page.isOrphan && <span className="text-red-600 font-medium flex-shrink-0">orphan</span>}
                        {!page.linksToPillar && page.subtopic !== 'Pillar page' && !page.isOrphan && (
                          <span className="text-amber-600 flex-shrink-0">no pillar link</span>
                        )}
                        {canSuggestLink && (
                          <button
                            onClick={() => addInternalLink(page, pillarPage)}
                            disabled={addingLinkFor === page.articleId}
                            className="text-orange-600 hover:text-orange-700 font-medium flex-shrink-0 disabled:opacity-50"
                          >
                            {addingLinkFor === page.articleId ? 'Adding…' : '+ Add link'}
                          </button>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>

              {(cluster.missingSubtopics || []).length > 0 && (
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-500 mb-1.5">Missing subtopics (content gaps):</p>
                  <div className="space-y-2">
                    {(cluster.missingSubtopics || []).map((topic: string, k: number) => (
                      <div
                        key={k}
                        className="flex flex-wrap items-center gap-2 text-xs bg-purple-50 text-purple-800 border border-purple-200 px-2.5 py-1.5 rounded-lg"
                      >
                        <span className="flex-1 min-w-[10rem]">+ {topic}</span>
                        <button
                          onClick={() => copyText(`gap-${i}-${k}`, topic)}
                          className="text-purple-700 hover:text-purple-900 font-medium"
                        >
                          {copiedKey === `gap-${i}-${k}` ? 'Copied' : 'Copy'}
                        </button>
                        <button
                          onClick={() => writeIdea(topic)}
                          className="text-orange-600 hover:text-orange-700 font-medium"
                        >
                          Write
                        </button>
                        <button
                          onClick={() => dismissGap(i, topic)}
                          disabled={saving}
                          className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {initialLoading && !result && (
        <div className="text-center py-16">
          <Loader2 className="w-6 h-6 text-gray-300 mx-auto animate-spin" />
        </div>
      )}

      {!result && !loading && !initialLoading && (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
          <MapIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No topical map yet</p>
          <p className="text-sm text-gray-400 mt-1 max-w-sm mx-auto">
            Your topical map is built automatically from articles you generate in SEORANKO.
            Generate at least 3 articles first, then click &ldquo;Build topical map&rdquo;.
          </p>
          <a
            href="/dashboard/keywords"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-xl transition-colors"
          >
            Go to Keywords to generate articles →
          </a>
        </div>
      )}
    </div>
  )
}

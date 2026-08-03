'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react'
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
// It previously had no shell of its own (it was embedded content, only ever
// reached via a redirect into Keywords). Cannibalisation moved in here too,
// since §3 frames it as a Station 2 gate ("route it to Station 3 as a
// revision" — preventing cannibalisation, not just detecting it later).
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

function TopicalMapContent() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // Same pattern as ContentROIDashboard (the working reference)

  async function generateMap() {
    setLoading(true)
    setError(null)
    try {
      // Get the session client-side (same as ContentROIDashboard's getUser pattern)
      // and pass the access token as a Bearer header so the API route doesn't need
      // to read cookies (which silently fails in Next.js 14 Route Handlers on refresh)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Not logged in — please refresh the page')
        setLoading(false)
        return
      }

      const res = await fetch('/api/topical-map', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        credentials: 'include'
      })
      const data = await res.json()
      if (data.success) setResult(data.result)
      else setError(data.error || 'Failed to build map')
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Topical Map</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Auto-built from your existing articles — shows clusters, gaps, and orphaned content.
          </p>
        </div>
        <button
          onClick={generateMap}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-xl disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {loading ? 'Building map...' : 'Build topical map'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Summary */}
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
                {result.clusters.flatMap((c: any) => c.missingSubtopics).length}
              </div>
              <div className="text-xs text-gray-500 mt-1">Missing subtopics</div>
            </div>
          </div>

          {/* Top recommendation */}
          <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
            <p className="text-sm font-semibold text-orange-800 mb-1">Top recommendation</p>
            <p className="text-sm text-orange-700">{result.topRecommendation}</p>
          </div>

          {/* Clusters */}
          {result.clusters.map((cluster: any, i: number) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{cluster.pillarTopic}</h3>
                  <p className="text-xs text-gray-400">Keyword: {cluster.pillarKeyword}</p>
                </div>
                <div className="text-right">
                  <div className={`text-2xl font-bold ${cluster.topicalAuthorityScore >= 70 ? 'text-green-600' : cluster.topicalAuthorityScore >= 40 ? 'text-amber-600' : 'text-red-500'}`}>
                    {cluster.topicalAuthorityScore}
                  </div>
                  <div className="text-xs text-gray-400">Authority score</div>
                </div>
              </div>

              {/* Cluster pages */}
              <div className="space-y-1.5">
                {cluster.clusterPages.map((page: any, j: number) => (
                  <div key={j} className={`flex items-center gap-2 text-xs p-2 rounded-lg ${page.isOrphan ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${page.subtopic === 'Pillar page' ? 'bg-purple-500' : page.linksToPillar ? 'bg-green-500' : 'bg-amber-400'}`} />
                    <span className="text-gray-700 flex-1 truncate">{page.title}</span>
                    {page.isOrphan && <span className="text-red-600 font-medium flex-shrink-0">orphan</span>}
                    {!page.linksToPillar && page.subtopic !== 'Pillar page' && !page.isOrphan && (
                      <span className="text-amber-600 flex-shrink-0">no pillar link</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Missing subtopics */}
              {cluster.missingSubtopics.length > 0 && (
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-500 mb-1.5">Missing subtopics (content gaps):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {cluster.missingSubtopics.map((topic: string, k: number) => (
                      <span key={k} className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full">
                        + {topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!result && !loading && (
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

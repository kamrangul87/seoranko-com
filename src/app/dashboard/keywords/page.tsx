'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { DashboardNav } from '@/components/DashboardNav'
import { WinnabilityCard } from '@/components/WinnabilityCard'
import type { WinnabilityResult } from '@/components/WinnabilityCard'

const COUNTRIES = [
  { value: 'Global', label: 'Global' }, { value: 'US', label: 'United States' },
  { value: 'UK', label: 'United Kingdom' }, { value: 'AU', label: 'Australia' },
  { value: 'CA', label: 'Canada' }, { value: 'IN', label: 'India' },
  { value: 'AE', label: 'UAE' }, { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' }, { value: 'SG', label: 'Singapore' },
]

const COUNTRY_LOCATION_CODE: Record<string, number> = {
  'Global': 2840, 'US': 2840, 'UK': 2826, 'AU': 2036,
  'CA': 2124, 'IN': 2356, 'AE': 2784, 'DE': 2276,
  'FR': 2250, 'SG': 2702,
}

function KdBadge({ kd }: { kd: number }) {
  const color = kd <= 35 ? 'bg-green-100 text-green-700' : kd <= 55 ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
  return <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${color}`}>{kd}</span>
}

interface LongTailKeyword {
  keyword: string
  volume: number
  difficulty: number
  parentKeyword: string
}

interface PendingCluster {
  pageId: string
  primaryKeyword: string
  secondaryKeywords: string[]
}

function ResearchPanel() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialQ = searchParams.get('q') || ''

  const [seed, setSeed]                       = useState(initialQ)
  const [country, setCountry]                 = useState('Global')
  const [keywords, setKeywords]               = useState<any[]>([])
  const [loading, setLoading]                 = useState(false)
  const [error, setError]                     = useState('')
  const [winnability, setWinnability]         = useState<WinnabilityResult | null>(null)
  const [checkingWinnability, setCheckingWinnability] = useState(false)
  const [selected, setSelected]               = useState<Set<string>>(new Set())
  const [buildingBrief, setBuildingBrief]     = useState(false)
  const [pendingCluster, setPendingCluster]   = useState<PendingCluster | null>(null)
  const [longTailSuggestions, setLongTailSuggestions] = useState<LongTailKeyword[]>([])
  const [includedLongTail, setIncludedLongTail] = useState<Set<string>>(new Set())
  const [expandingKeyword, setExpandingKeyword] = useState<string | null>(null)

  function toggleSelected(keyword: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(keyword)) next.delete(keyword)
      else next.add(keyword)
      return next
    })
  }

  function toggleLongTail(keyword: string) {
    setIncludedLongTail(prev => {
      const next = new Set(prev)
      if (next.has(keyword)) next.delete(keyword)
      else next.add(keyword)
      return next
    })
  }

  // §10 FEATURE — Plan (Station 2) should produce one Page per CLUSTER, not
  // one Page per keyword (§3). Groups the checked keywords into a single
  // primary/secondary keyword brief, auto-suggests easier-to-rank long-tail
  // variants of the primary keyword, and holds for confirmation before
  // handing off to Write.
  async function buildBriefFromSelected() {
    const chosen = keywords.filter((k: any) => selected.has(k.keyword))
    if (chosen.length < 2) return
    setBuildingBrief(true)
    setError('')
    try {
      const res = await fetch('/api/keywords/build-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: chosen.map((k: any) => ({ keyword: k.keyword, volume: k.volume, intent: k.intent })),
          country,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to build cluster brief')

      const suggestions: LongTailKeyword[] = data.longTailSuggestions || []
      setPendingCluster({ pageId: data.pageId, primaryKeyword: data.primaryKeyword, secondaryKeywords: data.secondaryKeywords || [] })
      setLongTailSuggestions(suggestions)
      setIncludedLongTail(new Set(suggestions.map(s => s.keyword))) // all included by default
    } catch (e: any) {
      setError(e.message || 'Failed to build cluster brief')
    } finally {
      setBuildingBrief(false)
    }
  }

  function continueToWrite() {
    if (!pendingCluster) return
    localStorage.setItem('cluster_brief_data', JSON.stringify({
      primaryKeyword: pendingCluster.primaryKeyword,
      secondaryKeywords: pendingCluster.secondaryKeywords,
      longTailKeywords: longTailSuggestions.filter(lt => includedLongTail.has(lt.keyword)).map(lt => lt.keyword),
      pageId: pendingCluster.pageId,
    }))
    router.push(`/dashboard/write?keyword=${encodeURIComponent(pendingCluster.primaryKeyword)}`)
  }

  function cancelCluster() {
    setPendingCluster(null)
    setLongTailSuggestions([])
    setIncludedLongTail(new Set())
  }

  // Manual per-keyword expansion (Step 5) — for a single selected keyword
  // rather than a full cluster. Inserts variants as grouped rows right under
  // the parent so they're selectable via the same checkboxes.
  async function expandSingleKeyword(keyword: string) {
    setExpandingKeyword(keyword)
    setError('')
    try {
      const res = await fetch('/api/keywords/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, country }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to expand keyword')

      const variants: LongTailKeyword[] = data.variants || []
      if (variants.length === 0) {
        setError(`No long-tail variants found for "${keyword}"`)
        return
      }

      setKeywords(prev => {
        const idx = prev.findIndex((k: any) => k.keyword === keyword)
        const newRows = variants.map(v => ({
          keyword: v.keyword, volume: v.volume, kd: v.difficulty, intent: undefined,
          isLongTail: true, parentKeyword: keyword,
        }))
        if (idx === -1) return [...prev, ...newRows]
        return [...prev.slice(0, idx + 1), ...newRows, ...prev.slice(idx + 1)]
      })
    } catch (e: any) {
      setError(e.message || 'Failed to expand keyword')
    } finally {
      setExpandingKeyword(null)
    }
  }

  async function checkWinnability(keyword: string) {
    if (!keyword.trim()) return
    setCheckingWinnability(true)
    setWinnability(null)
    try {
      const locationCode = COUNTRY_LOCATION_CODE[country] || 2840
      const res = await fetch('/api/ranko/winnability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, locationCode }),
      })
      const data = await res.json()
      if (data.result) setWinnability(data.result)
    } catch (err) {
      console.error('Winnability check failed:', err)
    } finally {
      setCheckingWinnability(false)
    }
  }

  async function search(kw?: string) {
    const term = (kw ?? seed).trim()
    if (!term) return
    setLoading(true)
    setError('')
    setKeywords([])
    setSelected(new Set())
    cancelCluster()
    const [, keywordsRes] = await Promise.allSettled([
      checkWinnability(term),
      fetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: term, country }),
      }),
    ])
    try {
      if (keywordsRes.status === 'fulfilled') {
        const res = keywordsRes.value
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed')
        setKeywords(data.keywords || [])
      }
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  // Auto-search if keyword came from dashboard
  useEffect(() => {
    if (initialQ) search(initialQ)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Research</h1>
        <p className="text-[#6B6B6B] text-sm">Find ranking opportunities — RANKO checks winnability before you write.</p>
      </div>

      <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={seed}
            onChange={e => setSeed(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="e.g. content marketing strategy"
            className="flex-1 bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-4 py-2.5 text-sm focus:outline-none focus:border-[#FF6B2C]/50"
          />
          <select
            value={country}
            onChange={e => setCountry(e.target.value)}
            className="bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2.5 text-sm focus:outline-none focus:border-[#FF6B2C]/50"
          >
            {COUNTRIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <button
            onClick={() => search()}
            disabled={loading || !seed.trim()}
            className="bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-50 text-[#0a0a0a] font-semibold text-sm px-6 py-2.5 rounded-[8px] whitespace-nowrap transition-colors"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
      </div>

      {/* Winnability */}
      {checkingWinnability && (
        <div className="rounded-xl border border-[#E8E8E4] bg-[#FAFAF8] p-4 mb-4 text-sm text-[#6B6B6B] flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-orange-400 animate-pulse" />
          RANKO is reading the SERP to score winnability...
        </div>
      )}
      {winnability && !checkingWinnability && <WinnabilityCard result={winnability} />}

      {/* Results */}
      {keywords.length > 0 && (
        <div className="bg-white border border-[#E8E8E4] rounded-[10px] overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-[#E8E8E4] flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">{keywords.length} keywords found</span>
            {selected.size >= 2 ? (
              <button
                onClick={buildBriefFromSelected}
                disabled={buildingBrief}
                className="bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-50 text-[#0a0a0a] font-semibold text-xs px-4 py-2 rounded-[8px] whitespace-nowrap transition-colors"
              >
                {buildingBrief ? 'Building brief…' : `Build brief from ${selected.size} selected keywords →`}
              </button>
            ) : (
              <span className="text-xs text-[#6B6B6B]">Select 2+ keywords to cluster, or click &quot;Write article&quot; for one</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E8E8E4] bg-[#FAFAF8]">
                  <th className="px-4 py-3 w-8"></th>
                  <th className="text-left text-xs font-medium text-[#6B6B6B] px-4 py-3">Keyword</th>
                  <th className="text-right text-xs font-medium text-[#6B6B6B] px-4 py-3">Volume</th>
                  <th className="text-right text-xs font-medium text-[#6B6B6B] px-4 py-3">KD</th>
                  <th className="text-left text-xs font-medium text-[#6B6B6B] px-4 py-3">Intent</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {keywords.slice(0, 50).map((k: any, i: number) => {
                  const isChecked = selected.has(k.keyword)
                  return (
                    <tr key={i} className={`border-b border-[#F5F4F1] hover:bg-[#FAFAF8] ${k.isLongTail ? 'bg-[#FAFAF8]/60' : ''}`}>
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelected(k.keyword)}
                          className="w-3.5 h-3.5 accent-[#FF6B2C]"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-sm text-[#0F0F0F]">
                        {k.isLongTail && <span className="text-[#C4C4C0] mr-1">↳</span>}
                        {k.keyword}
                        {k.isLongTail && <span className="ml-2 text-[10px] text-[#9B9B9B]">long-tail of &quot;{k.parentKeyword}&quot;</span>}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-right text-[#6B6B6B]">{k.volume?.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right"><KdBadge kd={k.kd} /></td>
                      <td className="px-4 py-2.5 text-xs text-[#6B6B6B] capitalize">{k.intent}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-3">
                          {!k.isLongTail && (
                            <button
                              onClick={() => expandSingleKeyword(k.keyword)}
                              disabled={expandingKeyword === k.keyword}
                              title="Find long-tail variants of this keyword"
                              className="text-xs text-blue-500 hover:text-blue-700 disabled:opacity-50 whitespace-nowrap"
                            >
                              {expandingKeyword === k.keyword ? 'Expanding…' : '✨ Expand'}
                            </button>
                          )}
                          {isChecked && selected.size >= 2 ? (
                            <span className="text-xs text-[#9B9B9B] whitespace-nowrap">In cluster ✓</span>
                          ) : (
                            <Link
                              href={`/dashboard/write?keyword=${encodeURIComponent(k.keyword)}`}
                              className="text-xs text-[#FF6B2C] hover:text-[#E85A1E] font-medium whitespace-nowrap"
                            >
                              Write article →
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cluster brief confirmation — shown before handing off to Write */}
      {pendingCluster && (
        <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4 mb-6">
          <p className="text-sm font-semibold text-[#0F0F0F] mb-1">
            Brief ready: <span className="text-[#FF6B2C]">{pendingCluster.primaryKeyword}</span>
          </p>
          {pendingCluster.secondaryKeywords.length > 0 && (
            <p className="text-xs text-[#6B6B6B] mb-3">
              Secondary keywords: {pendingCluster.secondaryKeywords.join(', ')}
            </p>
          )}

          {longTailSuggestions.length > 0 && (
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl mb-4">
              <p className="text-sm font-semibold text-blue-800 mb-2">
                RANKO added {longTailSuggestions.length} easier-to-rank long-tail terms to this brief:
              </p>
              <div className="space-y-1.5">
                {longTailSuggestions.map(lt => (
                  <label key={lt.keyword} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={includedLongTail.has(lt.keyword)}
                      onChange={() => toggleLongTail(lt.keyword)}
                      className="accent-[#FF6B2C]"
                    />
                    <span className="text-gray-700">{lt.keyword}</span>
                    <span className="text-xs text-gray-400">{lt.volume} vol · KD {lt.difficulty}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-blue-600 mt-2">
                Each appears 1-2 times max — won&apos;t dilute your primary keyword&apos;s density.
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={continueToWrite}
              className="bg-[#FF6B2C] hover:bg-[#E85A1E] text-[#0a0a0a] font-semibold text-sm px-5 py-2.5 rounded-[8px] transition-colors"
            >
              Continue to Write →
            </button>
            <button
              onClick={cancelCluster}
              className="text-sm text-[#6B6B6B] hover:text-[#0F0F0F] px-3 py-2.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Also see */}
      <div className="flex items-center gap-4 pt-2 border-t border-[#E8E8E4]">
        <span className="text-xs text-[#9B9B9B]">Also:</span>
        <Link href="/dashboard/keywords/topical-map" className="text-xs text-[#6B6B6B] hover:text-[#FF6B2C] transition-colors">
          View topical map →
        </Link>
        <Link href="/dashboard/keywords/serp-intent" className="text-xs text-[#6B6B6B] hover:text-[#FF6B2C] transition-colors">
          Analyse SERP intent →
        </Link>
        <Link href="/dashboard/keywords/discovery" className="text-xs text-[#6B6B6B] hover:text-[#FF6B2C] transition-colors">
          Discover keywords →
        </Link>
      </div>
    </div>
  )
}

export default function KeywordsPage() {
  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <Suspense fallback={<div className="p-8 text-[#6B6B6B]">Loading…</div>}>
          <ResearchPanel />
        </Suspense>
      </main>
    </div>
  )
}

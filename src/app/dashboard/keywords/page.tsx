'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, Suspense } from 'react'
import Link from 'next/link'
import { HubTabs } from '@/components/HubTabs'
import { DashboardNav } from '@/components/DashboardNav'
import dynamic from 'next/dynamic'
import TopicalMapPage from '../topical-map/page'
import { WinnabilityCard } from '@/components/WinnabilityCard'
import type { WinnabilityResult } from '@/components/WinnabilityCard'
import { SERPIntentAnalyser } from '@/components/SERPIntentAnalyser'

const DiscoveryPage = dynamic(() => import('../discovery/page'), { ssr: false })

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

const TABS = [
  { id: 'keywords',    label: 'Keywords',    icon: '🔍' },
  { id: 'topical-map', label: 'Topical Map', icon: '🗺️' },
  { id: 'discover',    label: 'Discovery',   icon: '💡' },
  { id: 'serp-intent', label: 'SERP Intent', icon: '🎯' },
]

function KdBadge({ kd }: { kd: number }) {
  const color = kd <= 35 ? 'bg-green-100 text-green-700' : kd <= 55 ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
  return <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${color}`}>{kd}</span>
}

function KeywordsPanel() {
  const [seed, setSeed]                       = useState('')
  const [country, setCountry]                 = useState('Global')
  const [keywords, setKeywords]               = useState<any[]>([])
  const [loading, setLoading]                 = useState(false)
  const [error, setError]                     = useState('')
  const [winnability, setWinnability]         = useState<WinnabilityResult | null>(null)
  const [checkingWinnability, setCheckingWinnability] = useState(false)

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

  async function search() {
    if (!seed.trim()) return
    setLoading(true)
    setError('')
    setKeywords([])
    // Run keyword search and winnability check in parallel
    const [, keywordsRes] = await Promise.allSettled([
      checkWinnability(seed.trim()),
      fetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: seed.trim(), country }),
      })
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

  return (
    <div className="max-w-6xl mx-auto px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Keyword Research</h1>
        <p className="text-[#6B6B6B] text-sm">Find ranking opportunities across 13+ markets.</p>
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
            onClick={search}
            disabled={loading || !seed.trim()}
            className="bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-50 text-[#0a0a0a] font-semibold text-sm px-6 py-2.5 rounded-[8px] whitespace-nowrap transition-colors"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
      </div>

      {/* RANKO Winnability score */}
      {checkingWinnability && (
        <div className="rounded-xl border border-[#E8E8E4] bg-[#FAFAF8] p-4 mb-4 text-sm text-[#6B6B6B] flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-orange-400 animate-pulse" />
          RANKO is reading the SERP to score winnability...
        </div>
      )}
      {winnability && !checkingWinnability && <WinnabilityCard result={winnability} />}

      {keywords.length > 0 && (
        <div className="bg-white border border-[#E8E8E4] rounded-[10px] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E8E8E4] flex items-center justify-between">
            <span className="text-sm font-semibold">{keywords.length} keywords found</span>
            <span className="text-xs text-[#6B6B6B]">Click &quot;Write article&quot; to open in Write</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E8E8E4] bg-[#FAFAF8]">
                  <th className="text-left text-xs font-medium text-[#6B6B6B] px-4 py-3">Keyword</th>
                  <th className="text-right text-xs font-medium text-[#6B6B6B] px-4 py-3">Volume</th>
                  <th className="text-right text-xs font-medium text-[#6B6B6B] px-4 py-3">KD</th>
                  <th className="text-left text-xs font-medium text-[#6B6B6B] px-4 py-3">Intent</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {keywords.slice(0, 50).map((k: any, i: number) => (
                  <tr key={i} className="border-b border-[#F5F4F1] hover:bg-[#FAFAF8]">
                    <td className="px-4 py-2.5 text-sm text-[#0F0F0F]">{k.keyword}</td>
                    <td className="px-4 py-2.5 text-sm text-right text-[#6B6B6B]">{k.volume?.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right"><KdBadge kd={k.kd} /></td>
                    <td className="px-4 py-2.5 text-xs text-[#6B6B6B] capitalize">{k.intent}</td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/dashboard/write?keyword=${encodeURIComponent(k.keyword)}`}
                        className="text-xs text-[#FF6B2C] hover:text-[#E85A1E] font-medium whitespace-nowrap"
                      >
                        Write article →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}


export default function KeywordsPage() {
  const [activeTab, setActiveTab] = useState('keywords')

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 pt-6 bg-white border-b border-[#E8E8E4] sticky top-0 z-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-3">Keywords</h2>
          <HubTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {activeTab === 'keywords'    && <KeywordsPanel />}
        {activeTab === 'topical-map' && <TopicalMapPage />}
        {activeTab === 'discover' && (
          <div style={{ overflow: 'hidden', width: '100%' }}>
            <div style={{ marginLeft: '-224px', display: 'flex', width: 'calc(100% + 224px)' }}>
              <Suspense fallback={<div className="p-8 text-[#6B6B6B]">Loading…</div>}>
                <DiscoveryPage />
              </Suspense>
            </div>
          </div>
        )}
        {activeTab === 'serp-intent' && <SERPIntentAnalyser />}
      </main>
    </div>
  )
}

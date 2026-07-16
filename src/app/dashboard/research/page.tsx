'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, Suspense } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { HubTabs } from '@/components/HubTabs'
import dynamic from 'next/dynamic'
import TopicalMapPage from '../topical-map/page'

const DiscoveryPage = dynamic(() => import('../discovery/page'), { ssr: false })

const COUNTRIES = [
  { value: 'Global', label: 'Global' }, { value: 'US', label: 'United States' },
  { value: 'UK', label: 'United Kingdom' }, { value: 'AU', label: 'Australia' },
  { value: 'CA', label: 'Canada' }, { value: 'IN', label: 'India' },
  { value: 'AE', label: 'UAE' }, { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' }, { value: 'SG', label: 'Singapore' },
]

const HUB_ITEMS = [
  { id: 'content', label: 'Content', href: '/dashboard' },
  { id: 'research', label: 'Research', href: '/dashboard/research' },
  { id: 'performance', label: 'Performance', href: '/dashboard/performance' },
  { id: 'intelligence', label: 'Intelligence', href: '/dashboard/intelligence' },
  { id: 'images', label: 'Images', href: '/dashboard?tab=images' },
  { id: 'settings', label: 'Settings', href: '/dashboard?tab=settings' },
]

const TABS = [
  { id: 'keywords', label: 'Keywords', icon: '🔍' },
  { id: 'topical-map', label: 'Topical Map', icon: '🗺️' },
  { id: 'discover', label: 'Discover', icon: '💡' },
]

function KdBadge({ kd }: { kd: number }) {
  const color = kd <= 35 ? 'bg-green-100 text-green-700' : kd <= 55 ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
  return <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${color}`}>{kd}</span>
}

function KeywordsPanel() {
  const [seed, setSeed] = useState('')
  const [country, setCountry] = useState('Global')
  const [keywords, setKeywords] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function search() {
    if (!seed.trim()) return
    setLoading(true)
    setError('')
    setKeywords([])
    try {
      const res = await fetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: seed.trim(), country }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setKeywords(data.keywords || [])
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
            className="bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-50 text-[#0a0a0a] font-semibold text-sm px-6 py-2.5 rounded-[8px] whitespace-nowrap"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
      </div>

      {keywords.length > 0 && (
        <div className="bg-white border border-[#E8E8E4] rounded-[10px] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E8E8E4] flex items-center justify-between">
            <span className="text-sm font-semibold">{keywords.length} keywords found</span>
            <span className="text-xs text-[#6B6B6B]">Click &quot;Write article&quot; to open in Content Hub</span>
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
                        href={`/dashboard?keyword=${encodeURIComponent(k.keyword)}`}
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

function HubSidebar() {
  const pathname = usePathname()

  async function signOut() {
    await fetch('/api/auth/signout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <aside className="w-56 flex-shrink-0 border-r border-[#E8E8E4] flex flex-col">
      <div className="px-5 py-5 border-b border-[#E8E8E4]">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-[#FF6B2C] rounded-[7px] flex items-center justify-center">
            <span className="text-[#0a0a0a] font-extrabold text-xs">S</span>
          </div>
          <span className="font-bold text-base tracking-tight">Seoranko</span>
        </Link>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {HUB_ITEMS.map(({ id, label, href }) => {
          const isActive = id === 'research'
            ? pathname.startsWith('/dashboard/research')
            : href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(href.split('?')[0])
          return (
            <Link
              key={id}
              href={href}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm font-medium transition-colors ${
                isActive ? 'bg-[#FF6B2C]/10 text-[#FF6B2C]' : 'text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-white'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="px-4 py-3 border-t border-[#E8E8E4]">
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-[8px] text-xs font-medium text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-white transition-colors"
        >
          Sign Out
        </button>
      </div>
    </aside>
  )
}

export default function ResearchHub() {
  const [activeTab, setActiveTab] = useState('keywords')

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <HubSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 pt-6 bg-white border-b border-[#E8E8E4] sticky top-0 z-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-3">Research Hub</h2>
          <HubTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {activeTab === 'keywords' && <KeywordsPanel />}
        {activeTab === 'topical-map' && <TopicalMapPage />}
        {activeTab === 'discover' && (
          <Suspense fallback={<div className="p-8 text-[#6B6B6B]">Loading…</div>}>
            <DiscoveryPage />
          </Suspense>
        )}
      </main>
    </div>
  )
}

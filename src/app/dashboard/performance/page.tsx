'use client'
import { useState, Suspense } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { HubTabs } from '@/components/HubTabs'
import { RankingAgentDashboard } from '@/components/RankingAgentDashboard'
import { ContentROIDashboard } from '@/components/ContentROIDashboard'

const HUB_ITEMS = [
  { id: 'content', label: 'Content', href: '/dashboard' },
  { id: 'research', label: 'Research', href: '/dashboard/research' },
  { id: 'performance', label: 'Performance', href: '/dashboard/performance' },
  { id: 'intelligence', label: 'Intelligence', href: '/dashboard/intelligence' },
  { id: 'images', label: 'Images', href: '/dashboard?tab=images' },
  { id: 'settings', label: 'Settings', href: '/dashboard?tab=settings' },
]

const TABS = [
  { id: 'rankings', label: 'Rankings', icon: '📈' },
  { id: 'roi', label: 'Content ROI', icon: '💰' },
  { id: 'cannibalization', label: 'Cannibalisation', icon: '⚠️' },
]

function CannibalPlaceholder() {
  return (
    <div className="max-w-3xl mx-auto px-8 py-16 text-center">
      <div className="text-4xl mb-4">⚠️</div>
      <h2 className="text-xl font-semibold text-gray-800 mb-2">Cannibalisation Detector</h2>
      <p className="text-gray-500 text-sm">
        Keyword cannibalisation analysis is coming soon. This tool will identify when multiple pages
        compete for the same keyword and hurt each other&apos;s rankings.
      </p>
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
          const isActive = id === 'performance'
            ? pathname.startsWith('/dashboard/performance')
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

export default function PerformanceHub() {
  const [activeTab, setActiveTab] = useState('rankings')

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <HubSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 pt-6 bg-white border-b border-[#E8E8E4] sticky top-0 z-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-3">Performance Hub</h2>
          <HubTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {activeTab === 'rankings' && (
          <div className="max-w-3xl mx-auto px-4 py-8">
            <RankingAgentDashboard />
          </div>
        )}
        {activeTab === 'roi' && (
          <div className="max-w-4xl mx-auto px-4 py-8">
            <ContentROIDashboard />
          </div>
        )}
        {activeTab === 'cannibalization' && (
          <Suspense fallback={<div className="p-8 text-[#6B6B6B]">Loading…</div>}>
            <CannibalPlaceholder />
          </Suspense>
        )}
      </main>
    </div>
  )
}

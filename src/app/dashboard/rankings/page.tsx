'use client'
import { useState, Suspense } from 'react'
import { HubTabs } from '@/components/HubTabs'
import { DashboardNav } from '@/components/DashboardNav'
import { RankingAgentDashboard } from '@/components/RankingAgentDashboard'
import { ContentROIDashboard } from '@/components/ContentROIDashboard'

const TABS = [
  { id: 'rankings',         label: 'Rankings',         icon: '📈' },
  { id: 'roi',              label: 'ROI',              icon: '💰' },
  { id: 'velocity',         label: 'Velocity',         icon: '⚡' },
  { id: 'cannibalisation',  label: 'Cannibalisation',  icon: '⚠️' },
]

function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="max-w-4xl mx-auto px-8 py-16 text-center">
      <div className="text-5xl mb-4">🚧</div>
      <h2 className="text-xl font-bold text-[#0F0F0F] mb-2">{title}</h2>
      <p className="text-[#6B6B6B] text-sm mb-6">{description}</p>
      <span className="inline-block bg-[#FF6B2C]/10 text-[#FF6B2C] text-xs font-semibold px-3 py-1.5 rounded-full">Coming in Phase 4</span>
    </div>
  )
}

export default function RankingsPage() {
  const [activeTab, setActiveTab] = useState('rankings')

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 pt-6 bg-white border-b border-[#E8E8E4] sticky top-0 z-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-3">Rankings</h2>
          <p className="text-xs text-[#9B9B9B] mb-3">Track positions, spot issues, prove ROI</p>
          <HubTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {activeTab === 'rankings' && (
          <div className="max-w-3xl mx-auto px-8 py-8">
            <Suspense fallback={<div className="text-[#6B6B6B]">Loading…</div>}>
              <RankingAgentDashboard />
            </Suspense>
          </div>
        )}
        {activeTab === 'roi' && (
          <div className="max-w-4xl mx-auto px-8 py-8">
            <Suspense fallback={<div className="text-[#6B6B6B]">Loading…</div>}>
              <ContentROIDashboard />
            </Suspense>
          </div>
        )}
        {activeTab === 'velocity' && (
          <ComingSoon
            title="Rank Velocity Predictor"
            description="Predict how quickly your content will climb the SERPs based on competition and authority signals."
          />
        )}
        {activeTab === 'cannibalisation' && (
          <ComingSoon
            title="Keyword Cannibalisation Detector"
            description="Find pages competing for the same keywords and get AI-powered merge or redirect recommendations."
          />
        )}
      </main>
    </div>
  )
}

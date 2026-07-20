'use client'
import { useState, Suspense } from 'react'
import { HubTabs } from '@/components/HubTabs'
import { DashboardNav } from '@/components/DashboardNav'
import dynamic from 'next/dynamic'

const SiteAuditPage = dynamic(() => import('../site-audit/page'), { ssr: false })

const TABS = [
  { id: 'geo-audit',          label: 'GEO Audit',          icon: '🔍' },
  { id: 'competitor-gap',     label: 'Competitor Gap',     icon: '🏆' },
  { id: 'topical-authority',  label: 'Topical Authority',  icon: '📊' },
  { id: 'entity',             label: 'Entity',             icon: '🧬' },
]

function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="max-w-3xl mx-auto px-8 py-16 text-center">
      <div className="text-5xl mb-4">🚧</div>
      <h2 className="text-xl font-bold text-[#0F0F0F] mb-2">{title}</h2>
      <p className="text-[#6B6B6B] text-sm mb-6 max-w-sm mx-auto">{description}</p>
      <span className="inline-block bg-[#FF6B2C]/10 text-[#FF6B2C] text-xs font-semibold px-3 py-1.5 rounded-full">Coming in Phase 4</span>
    </div>
  )
}

export default function IntelligencePage() {
  const [activeTab, setActiveTab] = useState('geo-audit')

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 pt-6 bg-white border-b border-[#E8E8E4] sticky top-0 z-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-3">Intelligence</h2>
          <p className="text-xs text-[#9B9B9B] mb-3">Audit your site, analyse competitors, find gaps</p>
          <HubTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {activeTab === 'geo-audit' && (
          <Suspense fallback={<div className="p-8 text-[#6B6B6B]">Loading GEO Audit…</div>}>
            <SiteAuditPage />
          </Suspense>
        )}
        {activeTab === 'competitor-gap' && (
          <ComingSoon
            title="Competitor Gap Analysis"
            description="Identify content gaps vs. top competitors — see what they rank for that you don't, and build a plan to close the gap."
          />
        )}
        {activeTab === 'topical-authority' && (
          <ComingSoon
            title="Topical Authority Scores"
            description="Measure how authoritative your site is on each topic cluster, and see where you need more depth."
          />
        )}
        {activeTab === 'entity' && (
          <ComingSoon
            title="Entity Coverage Scorer"
            description="Check which entities (people, places, organisations) your content covers vs. what top-ranking competitors mention."
          />
        )}
      </main>
    </div>
  )
}

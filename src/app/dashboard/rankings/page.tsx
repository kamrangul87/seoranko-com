'use client'
import { useState, useEffect, Suspense } from 'react'
import { HubTabs } from '@/components/HubTabs'
import { DashboardNav } from '@/components/DashboardNav'
import { RankingAgentDashboard } from '@/components/RankingAgentDashboard'
import { ContentROIDashboard } from '@/components/ContentROIDashboard'
import { RANKODiagnosisPanel } from '@/components/RANKODiagnosisPanel'
import { SiteSelector } from '@/components/SiteSelector'
import { supabase } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

// §10 item 13 / §5: "Velocity and decay become COLUMNS in Rankings, not
// screens." Velocity moved into the Track tab's article rows
// (RankingAgentDashboard.tsx). Decay has no built implementation yet —
// nothing to move for it. Cannibalisation moved to Plan (topical-map),
// since §3 frames it as a Station 2 gate, not a Rankings/Monitor concern.
const TABS = [
  { id: 'track',    label: 'Track',    icon: '📈' },
  { id: 'diagnose', label: 'Diagnose', icon: '🧠' },
  { id: 'roi',      label: 'ROI',      icon: '💰' },
]

export default function RankingsPage() {
  const [activeTab, setActiveTab] = useState('track')
  const [userId, setUserId] = useState('')
  // The domain chosen in the SiteSelector — no placeholder fallback.
  const [selectedSite, setSelectedSite] = useState<string | null>(null)
  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }: { data: { user: User | null } }) => {
      if (user) setUserId(user.id)
    })
  }, [])

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 pt-6 pb-0 bg-white border-b border-[#E8E8E4] sticky top-0 z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0">R</div>
            <div>
              <h1 className="text-xl font-semibold text-[#0F0F0F]">RANKO</h1>
              <p className="text-sm text-[#6B6B6B]">Autonomous SEO strategist · diagnoses, prescribes, acts</p>
            </div>
          </div>
          <HubTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {activeTab === 'track' && (
          <div className="max-w-3xl mx-auto px-8 py-8">
            <Suspense fallback={<div className="text-[#6B6B6B]">Loading…</div>}>
              <RankingAgentDashboard />
            </Suspense>
          </div>
        )}
        {activeTab === 'diagnose' && (
          <div className="max-w-3xl mx-auto px-8 py-8">
            <div className="mb-4">
              <SiteSelector
                selectedDomain={selectedSite}
                onSelect={setSelectedSite}
                onSelectSite={site => setSelectedSiteId(site.id)}
              />
            </div>
            {selectedSite ? (
              <RANKODiagnosisPanel
                userId={userId}
                siteUrl={`https://${selectedSite}`}
                siteId={selectedSiteId}
              />
            ) : (
              <div className="text-center py-12 text-gray-400 text-sm">
                Connect a site above to run a diagnosis
              </div>
            )}
          </div>
        )}
        {activeTab === 'roi' && (
          <div className="max-w-4xl mx-auto px-8 py-8">
            <Suspense fallback={<div className="text-[#6B6B6B]">Loading…</div>}>
              <ContentROIDashboard />
            </Suspense>
            <div className="max-w-4xl mx-auto mt-2">
              <a href="/dashboard/intelligence" className="text-xs text-[#FF6B2C] hover:underline">
                Site Audit (GEO signals) →
              </a>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

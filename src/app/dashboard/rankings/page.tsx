'use client'
import { useState, useEffect, Suspense } from 'react'
import { HubTabs } from '@/components/HubTabs'
import { DashboardNav } from '@/components/DashboardNav'
import { RankingAgentDashboard } from '@/components/RankingAgentDashboard'
import { ContentROIDashboard } from '@/components/ContentROIDashboard'
import { RANKODiagnosisPanel } from '@/components/RANKODiagnosisPanel'
import { VelocityPredictor } from '@/components/VelocityPredictor'
import { createBrowserClient } from '@supabase/ssr'

const TABS = [
  { id: 'rankings',      label: 'Rankings',          icon: '📈' },
  { id: 'roi',           label: 'ROI',               icon: '💰' },
  { id: 'velocity',      label: 'Velocity',          icon: '⚡' },
  { id: 'cannibalisation', label: 'Cannibalisation', icon: '⚠️' },
  { id: 'diagnosis',     label: 'RANKO Diagnosis',   icon: '🧠' },
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
  const [userId, setUserId] = useState('')
  const [siteUrl, setSiteUrl] = useState('https://yoursite.com')

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      const { data } = await supabase
        .from('user_profiles')
        .select('website_url, org_url')
        .eq('id', user.id)
        .single()
      if (data?.website_url) setSiteUrl(data.website_url)
      else if (data?.org_url) setSiteUrl(data.org_url)
    })
  }, [])

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 pt-6 pb-0 bg-white border-b border-[#E8E8E4] sticky top-0 z-10">
          {/* RANKO header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0">R</div>
            <div>
              <h1 className="text-xl font-semibold text-[#0F0F0F]">RANKO</h1>
              <p className="text-sm text-[#6B6B6B]">Autonomous SEO strategist · diagnoses, prescribes, acts</p>
            </div>
          </div>
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
          <div className="max-w-3xl mx-auto px-8 py-8">
            <VelocityPredictor />
          </div>
        )}
        {activeTab === 'cannibalisation' && (
          <ComingSoon
            title="Keyword Cannibalisation Detector"
            description="Find pages competing for the same keywords and get AI-powered merge or redirect recommendations."
          />
        )}
        {activeTab === 'diagnosis' && (
          <div className="max-w-3xl mx-auto px-8 py-8">
            <RANKODiagnosisPanel userId={userId} siteUrl={siteUrl} />
          </div>
        )}
      </main>
    </div>
  )
}

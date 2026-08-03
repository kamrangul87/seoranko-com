'use client'
import { Suspense } from 'react'
import { DashboardNav } from '@/components/DashboardNav'
import { ArticleWriter } from '@/components/ArticleWriter'

export default function WritePage() {
  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        {/* §10 item 13 — Keywords and Optimise are no longer top-nav (§9 rule
            3: instruments don't get their own menu item), linked from Write
            instead so they stay reachable. */}
        <div className="max-w-3xl mx-auto px-8 pt-4 flex gap-4 text-xs text-[#9B9B9B]">
          <a href="/dashboard/keywords" className="hover:text-[#FF6B2C] hover:underline">Keyword Research →</a>
          <a href="/dashboard/optimise" className="hover:text-[#FF6B2C] hover:underline">Optimise tools →</a>
        </div>
        <Suspense fallback={<div className="p-8 text-[#6B6B6B]">Loading…</div>}>
          <ArticleWriter />
        </Suspense>
      </main>
    </div>
  )
}

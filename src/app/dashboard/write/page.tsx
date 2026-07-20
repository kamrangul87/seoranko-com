'use client'
import { Suspense } from 'react'
import { DashboardNav } from '@/components/DashboardNav'
import { ArticleWriter } from '@/components/ArticleWriter'

export default function WritePage() {
  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <Suspense fallback={<div className="p-8 text-[#6B6B6B]">Loading…</div>}>
          <ArticleWriter />
        </Suspense>
      </main>
    </div>
  )
}

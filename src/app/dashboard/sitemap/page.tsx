'use client'

import { Suspense } from 'react'
import { DashboardNav } from '@/components/DashboardNav'
import { SitemapGeneratorPanel } from '@/components/SitemapGeneratorPanel'

function SitemapPageInner() {
  return (
    <div className="flex min-h-screen bg-[#F5F4F1]">
      <DashboardNav />
      <main className="flex-1 p-6 md:p-8 overflow-y-auto">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sitemap</h1>
            <p className="text-sm text-[#6B6B6B] mt-1">
              Generate and validate sitemap.xml from your Index Diagnosis crawl — indexable URLs only.
            </p>
          </div>
          <SitemapGeneratorPanel />
        </div>
      </main>
    </div>
  )
}

export default function SitemapPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[#6B6B6B]">Loading…</div>}>
      <SitemapPageInner />
    </Suspense>
  )
}

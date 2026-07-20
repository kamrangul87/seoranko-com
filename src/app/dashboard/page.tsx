'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { DashboardNav } from '@/components/DashboardNav'

interface RecentArticle {
  id: string
  title: string
  keyword: string
  article_url?: string
  current_position?: number | null
  perplexity_cited?: boolean | null
  created_at?: string
}

interface Stats {
  articlesWritten: number
  onPage1: number
  citedByAI: number
  avgPosition: number | null
}

function StatCard({
  label, value, sub, icon, href,
}: {
  label: string
  value: string | number
  sub?: string
  icon: string
  href?: string
}) {
  const content = (
    <div className="bg-white border border-[#E8E8E4] rounded-[12px] p-5 hover:border-[#FF6B2C]/30 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        {href && (
          <svg className="w-4 h-4 text-[#9B9B9B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </div>
      <div className="text-3xl font-bold text-[#0F0F0F] mb-1">{value}</div>
      <div className="text-sm font-medium text-[#0F0F0F]">{label}</div>
      {sub && <div className="text-xs text-[#9B9B9B] mt-0.5">{sub}</div>}
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : <div>{content}</div>
}

export default function DashboardOverviewPage() {
  const [stats, setStats]           = useState<Stats>({ articlesWritten: 0, onPage1: 0, citedByAI: 0, avgPosition: null })
  const [recentArticles, setRecent] = useState<RecentArticle[]>([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: articles } = await supabase
        .from('articles')
        .select('id, title, keyword, article_url, current_position, perplexity_cited, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50)

      if (articles) {
        const onPage1    = articles.filter(a => a.current_position != null && a.current_position <= 10).length
        const citedByAI  = articles.filter(a => a.perplexity_cited === true).length
        const positions  = articles.filter(a => a.current_position != null).map(a => a.current_position as number)
        const avgPos     = positions.length > 0 ? Math.round(positions.reduce((s, p) => s + p, 0) / positions.length) : null

        setStats({ articlesWritten: articles.length, onPage1, citedByAI, avgPosition: avgPos })
        setRecent(articles.slice(0, 5))
      }

      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
            <p className="text-[#6B6B6B] text-sm">Your SEO content overview.</p>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard
              icon="📝"
              label="Articles Written"
              value={loading ? '—' : stats.articlesWritten}
              href="/dashboard/rankings"
            />
            <StatCard
              icon="🥇"
              label="On Page 1"
              value={loading ? '—' : stats.onPage1}
              sub="Position ≤ 10"
              href="/dashboard/rankings"
            />
            <StatCard
              icon="🤖"
              label="Cited by AI"
              value={loading ? '—' : stats.citedByAI}
              sub="Perplexity citations"
              href="/dashboard/rankings"
            />
            <StatCard
              icon="📊"
              label="Avg Position"
              value={loading ? '—' : stats.avgPosition != null ? `#${stats.avgPosition}` : '—'}
              sub="Tracked articles"
              href="/dashboard/rankings"
            />
          </div>

          {/* Quick actions */}
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-[#0F0F0F] mb-3">Quick Actions</h2>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard/write"
                className="flex items-center gap-2 bg-[#FF6B2C] hover:bg-[#E85A1E] text-[#0a0a0a] font-semibold text-sm px-5 py-2.5 rounded-[8px] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Write new article
              </Link>
              <Link
                href="/dashboard/rankings"
                className="flex items-center gap-2 bg-white border border-[#E8E8E4] hover:border-[#FF6B2C]/40 text-[#0F0F0F] font-medium text-sm px-5 py-2.5 rounded-[8px] transition-colors"
              >
                <svg className="w-4 h-4 text-[#FF6B2C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                Check rankings
              </Link>
              <Link
                href="/dashboard/intelligence"
                className="flex items-center gap-2 bg-white border border-[#E8E8E4] hover:border-[#FF6B2C]/40 text-[#0F0F0F] font-medium text-sm px-5 py-2.5 rounded-[8px] transition-colors"
              >
                <svg className="w-4 h-4 text-[#FF6B2C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Run GEO audit
              </Link>
              <Link
                href="/dashboard/keywords"
                className="flex items-center gap-2 bg-white border border-[#E8E8E4] hover:border-[#FF6B2C]/40 text-[#0F0F0F] font-medium text-sm px-5 py-2.5 rounded-[8px] transition-colors"
              >
                <svg className="w-4 h-4 text-[#FF6B2C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Find keywords
              </Link>
            </div>
          </div>

          {/* Recent articles */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[#0F0F0F]">Recent Articles</h2>
              <Link href="/dashboard/rankings" className="text-xs text-[#FF6B2C] hover:underline">
                View all →
              </Link>
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-14 bg-white border border-[#E8E8E4] rounded-[10px] animate-pulse" />
                ))}
              </div>
            ) : recentArticles.length === 0 ? (
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-10 text-center">
                <div className="text-3xl mb-3">📝</div>
                <p className="text-[#6B6B6B] text-sm mb-4">No tracked articles yet</p>
                <Link
                  href="/dashboard/write"
                  className="inline-flex items-center gap-2 bg-[#FF6B2C] text-[#0a0a0a] font-semibold text-sm px-5 py-2.5 rounded-[8px] hover:bg-[#E85A1E] transition-colors"
                >
                  Write your first article →
                </Link>
              </div>
            ) : (
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] overflow-hidden">
                {recentArticles.map((art, i) => (
                  <div
                    key={art.id}
                    className={`flex items-center gap-4 px-5 py-3.5 ${i < recentArticles.length - 1 ? 'border-b border-[#F5F4F1]' : ''} hover:bg-[#FAFAF8] transition-colors`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#0F0F0F] truncate">{art.title || art.keyword}</p>
                      <p className="text-xs text-[#9B9B9B] truncate">{art.keyword}</p>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      {art.current_position != null && (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          art.current_position <= 3 ? 'bg-green-100 text-green-700' :
                          art.current_position <= 10 ? 'bg-blue-100 text-blue-700' :
                          'bg-[#F5F4F1] text-[#6B6B6B]'
                        }`}>
                          #{art.current_position}
                        </span>
                      )}
                      {art.perplexity_cited && (
                        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">AI cited</span>
                      )}
                      {art.article_url && (
                        <a
                          href={art.article_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[#6B6B6B] hover:text-[#FF6B2C] transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  )
}

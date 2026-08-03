'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import { DashboardNav } from '@/components/DashboardNav'
import { STAGE_NAME } from '@/lib/pages'

interface RecentArticle {
  id: string
  title: string
  keyword: string
  article_url?: string
  current_position?: number | null
  created_at?: string
  // §10 item 13 — this screen is now "Pipeline" (§2/§5): the station a page
  // sits at, sourced from the pages shadow record (item 7/8) keyed by article_id.
  stage?: number | null
}

function OnboardingSteps() {
  return (
    <div className="mt-8 border border-[#E8E8E4] rounded-[12px] p-6 bg-white">
      <p className="text-xs font-semibold uppercase tracking-wider text-[#9B9B9B] mb-5">How it works</p>
      <div className="grid grid-cols-3 gap-6">
        {[
          {
            icon: '🔍',
            step: '1',
            title: 'Research',
            desc: "Enter a keyword above — RANKO checks if it's worth targeting before you spend time writing.",
          },
          {
            icon: '✍️',
            step: '2',
            title: 'Write',
            desc: 'Generate a fully optimised article that matches search intent and targets AI citation.',
          },
          {
            icon: '📈',
            step: '3',
            title: 'Track',
            desc: 'RANKO monitors your ranking every week and tells you when to refresh or improve.',
          },
        ].map(item => (
          <div key={item.step} className="text-center">
            <div className="text-3xl mb-2">{item.icon}</div>
            <p className="text-[10px] font-semibold text-[#9B9B9B] uppercase tracking-wide mb-1">Step {item.step}</p>
            <p className="text-sm font-semibold text-[#0F0F0F] mb-1">{item.title}</p>
            <p className="text-xs text-[#6B6B6B] leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function RecentArticles({ articles, loading }: { articles: RecentArticle[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-14 bg-[#F5F4F1] rounded-[10px] animate-pulse" />
        ))}
      </div>
    )
  }
  if (articles.length === 0) return null
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-[#0F0F0F]">
          {articles.length === 1 ? '1 article written' : `${articles.length} articles written`}
        </p>
        <Link href="/dashboard/rankings" className="text-xs text-[#FF6B2C] hover:underline">
          Track rankings →
        </Link>
      </div>
      <div className="bg-white border border-[#E8E8E4] rounded-[10px] overflow-hidden">
        {articles.map((art, i) => (
          <div
            key={art.id}
            className={`flex items-center gap-4 px-5 py-3.5 hover:bg-[#FAFAF8] transition-colors ${
              i < articles.length - 1 ? 'border-b border-[#F5F4F1]' : ''
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#0F0F0F] truncate">{art.title || art.keyword}</p>
              <p className="text-xs text-[#9B9B9B] truncate">{art.keyword}</p>
            </div>
            {art.stage != null && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#F5F4F1] text-[#6B6B6B] flex-shrink-0">
                {STAGE_NAME[art.stage] ?? art.stage}
              </span>
            )}
            {art.current_position != null && (
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                  art.current_position <= 3
                    ? 'bg-green-100 text-green-700'
                    : art.current_position <= 10
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-[#F5F4F1] text-[#6B6B6B]'
                }`}
              >
                #{art.current_position}
              </span>
            )}
            {art.article_url && (
              <a
                href={art.article_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#9B9B9B] hover:text-[#FF6B2C] flex-shrink-0 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [keyword, setKeyword] = useState('')
  const [articles, setArticles] = useState<RecentArticle[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }: { data: { user: User | null } }) => {
      if (!user) { setLoading(false); return }
      const { data } = await supabase
        .from('articles')
        .select('id, title, keyword, article_url, current_position, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10)

      const articleIds = (data || []).map((a: RecentArticle) => a.id)
      const stageByArticle: Record<string, number> = {}
      if (articleIds.length > 0) {
        const { data: pageRows } = await supabase
          .from('pages')
          .select('article_id, stage')
          .in('article_id', articleIds)
        for (const p of pageRows || []) {
          if (p.article_id) stageByArticle[p.article_id] = p.stage
        }
      }

      setArticles((data || []).map((a: RecentArticle) => ({
        ...a,
        stage: stageByArticle[a.id] ?? null
      })))
      setLoading(false)
    })
  }, [])

  function handleAnalyse() {
    if (!keyword.trim()) return
    router.push(`/dashboard/keywords?q=${encodeURIComponent(keyword.trim())}`)
  }

  return (
    <div
      className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden"
      style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}
    >
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-12">
          {/* Main CTA */}
          <div className="text-center mb-10">
            <div className="w-12 h-12 bg-[#FF6B2C] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-white font-bold text-lg">R</span>
            </div>
            <h1 className="text-2xl font-bold text-[#0F0F0F] mb-2">What do you want to rank for?</h1>
            <p className="text-[#6B6B6B] text-sm">
              RANKO checks if it is worth targeting, then helps you write content that reaches Page 1.
            </p>
          </div>

          {/* Keyword input */}
          <div className="flex gap-2 mb-12">
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAnalyse()}
              placeholder="e.g. best ev charger uk 2026"
              autoFocus
              className="flex-1 px-4 py-3 text-base border-2 border-[#E8E8E4] rounded-xl focus:outline-none focus:border-[#FF6B2C] transition-colors bg-white"
            />
            <button
              onClick={handleAnalyse}
              disabled={!keyword.trim()}
              className="px-6 py-3 bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-50 text-white font-medium rounded-xl transition-colors whitespace-nowrap"
            >
              Analyse →
            </button>
          </div>

          {/* Recent articles or onboarding */}
          {!loading && articles.length === 0 ? (
            <OnboardingSteps />
          ) : (
            <RecentArticles articles={articles} loading={loading} />
          )}
        </div>
      </main>
    </div>
  )
}

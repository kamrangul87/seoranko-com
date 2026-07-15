'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

interface ROIArticle {
  id: string
  title: string
  keyword: string
  created_at: string
  rank_score: number | null
  current_position: number | null
  starting_position: number | null
  perplexity_cited: boolean | null
  freshness_status: string
  positions_gained: number | null
}

function TrendUp({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  )
}

function TrendDown({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0v-8m0 8l-8-8-4 4-6-6" />
    </svg>
  )
}

function MinusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
    </svg>
  )
}

function FileText({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

export function ContentROIDashboard() {
  const [articles, setArticles] = useState<ROIArticle[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data } = await supabase
      .from('articles')
      .select(`
        id, title, keyword, created_at, rank_score,
        ranking_agent_articles (
          current_position, position_change, perplexity_cited, freshness_status
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const mapped: ROIArticle[] = (data || []).map((a: any) => {
      const tracking = a.ranking_agent_articles?.[0]
      return {
        id: a.id,
        title: a.title || a.keyword,
        keyword: a.keyword,
        created_at: a.created_at,
        rank_score: a.rank_score,
        current_position: tracking?.current_position || null,
        starting_position: null,
        perplexity_cited: tracking?.perplexity_cited ?? null,
        freshness_status: tracking?.freshness_status || 'fresh',
        positions_gained: tracking?.position_change ? -tracking.position_change : null
      }
    })

    setArticles(mapped)
    setLoading(false)
  }

  const totalArticles = articles.length
  const rankedArticles = articles.filter(a => a.current_position !== null)
  const page1Articles = rankedArticles.filter(a => a.current_position! <= 10)
  const citedArticles = articles.filter(a => a.perplexity_cited === true)
  const totalPositionsGained = articles
    .filter(a => a.positions_gained !== null && a.positions_gained > 0)
    .reduce((sum, a) => sum + (a.positions_gained || 0), 0)

  function positionColor(pos: number | null) {
    if (!pos) return 'text-gray-400'
    if (pos <= 3) return 'text-green-600'
    if (pos <= 10) return 'text-blue-600'
    if (pos <= 30) return 'text-amber-600'
    return 'text-red-500'
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading ROI data...</div>
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Content ROI</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Articles created → rankings gained → AI citations earned
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export report
        </button>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Articles written', value: totalArticles, Icon: FileText, color: 'text-gray-700' },
          { label: 'On Page 1', value: page1Articles.length, Icon: TrendUp, color: 'text-green-600' },
          { label: 'Cited by AI', value: citedArticles.length, Icon: TrendUp, color: 'text-purple-600' },
          { label: 'Positions gained', value: `+${totalPositionsGained}`, Icon: TrendUp, color: 'text-blue-600' }
        ].map((stat, i) => (
          <div key={i} className="bg-gray-50 rounded-xl border border-gray-200 p-4 text-center">
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-gray-500 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Articles ROI table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-800">Article performance</p>
        </div>
        <div className="divide-y divide-gray-100">
          {articles.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No articles yet — generate your first article to see ROI data.</p>
          )}
          {articles.map(article => (
            <div key={article.id} className="flex items-center gap-3 px-4 py-3">
              {/* Date */}
              <div className="text-xs text-gray-400 w-20 flex-shrink-0">
                {new Date(article.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </div>

              {/* Title */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{article.title}</p>
                <p className="text-xs text-gray-400 truncate">{article.keyword}</p>
              </div>

              {/* RANK score */}
              <div className="text-center w-14">
                <div className={`text-sm font-bold ${article.rank_score && article.rank_score >= 80 ? 'text-green-600' : article.rank_score && article.rank_score >= 60 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {article.rank_score || '—'}
                </div>
                <div className="text-xs text-gray-400">RANK</div>
              </div>

              {/* Position */}
              <div className="text-center w-14">
                <div className={`text-sm font-bold ${positionColor(article.current_position)}`}>
                  {article.current_position ? `#${article.current_position}` : '—'}
                </div>
                <div className="text-xs text-gray-400">Position</div>
              </div>

              {/* Positions gained */}
              <div className="text-center w-16">
                {article.positions_gained !== null ? (
                  <div className={`text-sm font-bold flex items-center justify-center gap-0.5 ${article.positions_gained > 0 ? 'text-green-600' : article.positions_gained < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                    {article.positions_gained > 0
                      ? <TrendUp className="w-3 h-3" />
                      : article.positions_gained < 0
                        ? <TrendDown className="w-3 h-3" />
                        : <MinusIcon className="w-3 h-3" />}
                    {article.positions_gained > 0 ? `+${article.positions_gained}` : article.positions_gained}
                  </div>
                ) : (
                  <div className="text-sm text-gray-300">—</div>
                )}
                <div className="text-xs text-gray-400">Change</div>
              </div>

              {/* AI cited */}
              <div className="text-center w-14">
                <div className={`text-sm font-bold ${article.perplexity_cited === true ? 'text-purple-600' : article.perplexity_cited === false ? 'text-red-400' : 'text-gray-300'}`}>
                  {article.perplexity_cited === true ? '✓' : article.perplexity_cited === false ? '✗' : '—'}
                </div>
                <div className="text-xs text-gray-400">AI cited</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

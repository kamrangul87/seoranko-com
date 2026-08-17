'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase-client'

interface ROIArticle {
  id: string
  title: string
  keyword: string
  created_at: string
  rank_score: number | null
  current_position: number | null
  perplexity_cited: boolean | null
  freshness_status: string
  positions_gained: number | null
  deleted_at: string | null
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

function toSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'article'
}

export function ContentROIDashboard() {
  const [articles, setArticles] = useState<ROIArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(false)
      setArticles([])
    }, 10000)

    load().finally(() => clearTimeout(timeout))
    return () => clearTimeout(timeout)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    setActionError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // Prefer soft-delete aware select; fall back if column not migrated yet
    let articleRows: any[] | null = null
    const withDeleted = await supabase
      .from('articles')
      .select('id, title, keyword, created_at, rank_score, deleted_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(80)

    if (withDeleted.error) {
      const fallback = await supabase
        .from('articles')
        .select('id, title, keyword, created_at, rank_score')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50)
      articleRows = (fallback.data || []).map((a: any) => ({ ...a, deleted_at: null }))
    } else {
      articleRows = withDeleted.data
    }

    if (!articleRows?.length) { setLoading(false); setArticles([]); return }

    const articleIds = articleRows.map((a: any) => a.id)
    const { data: tracking } = await supabase
      .from('ranking_agent_articles')
      .select('article_id, current_position, position_change, perplexity_cited, freshness_status')
      .in('article_id', articleIds)

    const trackingMap: Record<string, any> = Object.fromEntries(
      (tracking || []).map((t: any) => [t.article_id, t])
    )

    const mapped: ROIArticle[] = articleRows.map((a: any) => {
      const t = trackingMap[a.id]
      return {
        id: a.id,
        title: a.title || a.keyword,
        keyword: a.keyword,
        created_at: a.created_at,
        rank_score: a.rank_score,
        current_position: t?.current_position || null,
        perplexity_cited: t?.perplexity_cited ?? null,
        freshness_status: t?.freshness_status || 'fresh',
        positions_gained: t?.position_change ? -t.position_change : null,
        deleted_at: a.deleted_at || null,
      }
    })

    setArticles(mapped)
    setLoading(false)
  }

  async function deleteArticle(article: ROIArticle) {
    if (!confirm(`Delete “${article.title}”? You can retrieve it later from Deleted articles.`)) return
    setActionId(article.id)
    setActionError(null)
    try {
      const res = await fetch(`/api/articles/manage?id=${encodeURIComponent(article.id)}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActionError(data.error || 'Delete failed')
        return
      }
      if (data.mode === 'hard') {
        setArticles(prev => prev.filter(a => a.id !== article.id))
      } else {
        setArticles(prev => prev.map(a =>
          a.id === article.id ? { ...a, deleted_at: new Date().toISOString() } : a
        ))
        setShowDeleted(true)
      }
    } catch (err) {
      setActionError(String(err))
    } finally {
      setActionId(null)
    }
  }

  async function restoreArticle(article: ROIArticle) {
    setActionId(article.id)
    setActionError(null)
    try {
      const res = await fetch('/api/articles/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: article.id, action: 'restore' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActionError(data.error || 'Retrieve failed')
        return
      }
      setArticles(prev => prev.map(a =>
        a.id === article.id ? { ...a, deleted_at: null } : a
      ))
    } catch (err) {
      setActionError(String(err))
    } finally {
      setActionId(null)
    }
  }

  async function downloadArticle(article: ROIArticle) {
    setActionId(article.id)
    setActionError(null)
    try {
      const res = await fetch('/api/articles/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: article.id, action: 'download' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.content) {
        setActionError(data.error || 'Download failed')
        return
      }
      const blob = new Blob([data.content], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${toSlug(data.keyword || data.title || article.title)}.html`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setActionError(String(err))
    } finally {
      setActionId(null)
    }
  }

  const active = articles.filter(a => !a.deleted_at)
  const deleted = articles.filter(a => !!a.deleted_at)

  const totalArticles = active.length
  const rankedArticles = active.filter(a => a.current_position !== null)
  const page1Articles = rankedArticles.filter(a => a.current_position! <= 10)
  const citedArticles = active.filter(a => a.perplexity_cited === true)
  const totalPositionsGained = active
    .filter(a => a.positions_gained !== null && a.positions_gained > 0)
    .reduce((sum, a) => sum + (a.positions_gained || 0), 0)

  // §10 item 10 — aligned to canonical bands (§7.1): 1-3 / 4-10 / 11-20 / 21-50 / 51+.
  function positionColor(pos: number | null) {
    if (!pos) return 'text-gray-400'
    if (pos <= 3) return 'text-green-600'
    if (pos <= 10) return 'text-blue-600'
    if (pos <= 20) return 'text-amber-600'
    if (pos <= 50) return 'text-orange-600'
    return 'text-red-500'
  }

  function ArticleRow({ article, mode }: { article: ROIArticle; mode: 'active' | 'deleted' }) {
    const busy = actionId === article.id
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="text-xs text-gray-400 w-20 flex-shrink-0">
          {new Date(article.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{article.title}</p>
          <p className="text-xs text-gray-400 truncate">{article.keyword}</p>
        </div>

        <div className="text-center w-14">
          <div className={`text-sm font-bold ${article.rank_score && article.rank_score >= 80 ? 'text-green-600' : article.rank_score && article.rank_score >= 60 ? 'text-amber-600' : 'text-gray-400'}`}>
            {article.rank_score || '—'}
          </div>
          <div className="text-xs text-gray-400">RANK</div>
        </div>

        <div className="text-center w-14">
          <div className={`text-sm font-bold ${positionColor(article.current_position)}`}>
            {article.current_position ? `#${article.current_position}` : '—'}
          </div>
          <div className="text-xs text-gray-400">Position</div>
        </div>

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

        <div className="text-center w-14">
          <div className={`text-sm font-bold ${article.perplexity_cited === true ? 'text-purple-600' : article.perplexity_cited === false ? 'text-red-400' : 'text-gray-300'}`}>
            {article.perplexity_cited === true ? '✓' : article.perplexity_cited === false ? '✗' : '—'}
          </div>
          <div className="text-xs text-gray-400">AI cited</div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 w-36 justify-end">
          {mode === 'active' ? (
            <>
              <button
                onClick={() => downloadArticle(article)}
                disabled={busy}
                className="text-xs text-gray-500 hover:text-orange-600 disabled:opacity-50"
              >
                {busy ? '…' : 'Download'}
              </button>
              <button
                onClick={() => deleteArticle(article)}
                disabled={busy}
                className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
              >
                Delete
              </button>
            </>
          ) : (
            <button
              onClick={() => restoreArticle(article)}
              disabled={busy}
              className="text-xs text-orange-600 hover:text-orange-700 font-medium disabled:opacity-50"
            >
              {busy ? 'Retrieving…' : 'Retrieve'}
            </button>
          )}
        </div>
      </div>
    )
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

      {actionError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg break-words">
          {actionError}
        </p>
      )}

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
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-gray-800">Article performance</p>
          {deleted.length > 0 && (
            <button
              onClick={() => setShowDeleted(v => !v)}
              className="text-xs text-gray-500 hover:text-orange-600"
            >
              {showDeleted ? 'Hide' : 'Show'} deleted ({deleted.length})
            </button>
          )}
        </div>
        <div className="divide-y divide-gray-100">
          {active.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8 px-6">
              Content ROI tracks articles written in SEORANKO. Tracked URLs in the
              Track tab aren&rsquo;t counted here — they live on your own site, so
              there are no generation stats to report.{' '}
              <a href="/dashboard/write" className="text-orange-500 underline">
                Write your first one
              </a>.
            </p>
          )}
          {active.map(article => (
            <ArticleRow key={article.id} article={article} mode="active" />
          ))}
        </div>
      </div>

      {showDeleted && deleted.length > 0 && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-700">Deleted articles</p>
            <p className="text-xs text-gray-400 mt-0.5">Retrieve restores an article to the ROI list</p>
          </div>
          <div className="divide-y divide-gray-100">
            {deleted.map(article => (
              <ArticleRow key={article.id} article={article} mode="deleted" />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

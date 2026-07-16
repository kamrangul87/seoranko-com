'use client'
import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { LOCATION_OPTIONS } from '@/lib/rank-tracker'
import type { RankingDiagnosis } from '@/lib/ranking-intelligence'

interface TrackedArticle {
  id: string
  title: string
  keyword: string
  article_url: string
  current_position: number | null
  previous_position: number | null
  position_change: number | null
  top_competitor: string | null
  location_code: number
  last_rank_check: string | null
  last_reoptimise_at: string | null
  perplexity_cited: boolean | null
  citation_share_of_voice: number | null
  cited_competitors: string[]
  freshness_status: string
  needs_refresh: boolean
  last_diagnosis?: RankingDiagnosis | null
  rank_history?: Array<{ position: number | null; checked_at: string }>
}

interface AddForm {
  keyword: string
  articleUrl: string
  title: string
  locationCode: number
}

// Inline icon components (lucide-react not installed)
function IconTrendingUp({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  )
}
function IconTrendingDown({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </svg>
  )
}
function IconMinus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
function IconRefreshCw({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}
function IconLoader2({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  )
}
function IconAlertTriangle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
function IconCheckCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}
function IconXCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}
function IconGlobe({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

export function RankingAgentDashboard() {
  const [articles, setArticles] = useState<TrackedArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [diagnosing, setDiagnosing] = useState<string | null>(null)
  const [diagnoses, setDiagnoses] = useState<Record<string, RankingDiagnosis>>({})
  const [currentUser, setCurrentUser] = useState<{ id: string } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<AddForm>({
    keyword: '', articleUrl: '', title: '', locationCode: 2840
  })

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    setCurrentUser(user)

    const { data } = await supabase
      .from('ranking_agent_articles')
      .select('*, rank_history(position, checked_at)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    setArticles(data || [])

    // Seed cached diagnoses from DB
    const cached: Record<string, RankingDiagnosis> = {}
    for (const a of (data || [])) {
      if (a.last_diagnosis) cached[a.id] = a.last_diagnosis
    }
    setDiagnoses(prev => ({ ...cached, ...prev }))

    setLoading(false)
  }

  async function addArticle() {
    if (!form.keyword || !form.articleUrl) return
    setAdding(true)
    setAddError(null)

    try {
      if (!currentUser) {
        setAddError('Not logged in — please refresh the page')
        return
      }
      const user = currentUser

      const { error } = await supabase
        .from('ranking_agent_articles')
        .insert({
          user_id: user.id,
          keyword: form.keyword,
          article_url: form.articleUrl,
          title: form.title || form.keyword,
          location_code: form.locationCode,
          freshness_status: 'fresh',
          needs_refresh: false
        })

      if (error) {
        setAddError(`Failed to add: ${error.message}`)
        setAdding(false)
        return
      }

      setForm({ keyword: '', articleUrl: '', title: '', locationCode: 2840 })
      setShowForm(false)
      load()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add article')
    } finally {
      setAdding(false)
    }
  }

  async function checkNow(article: TrackedArticle) {
    setChecking(article.id)
    try {
      await fetch('/api/rank/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: article.keyword,
          articleUrl: article.article_url,
          articleId: article.id,
          previousPosition: article.current_position,
          locationCode: article.location_code || 2840
        })
      })
      load()
    } catch (err) {
      console.error('Rank check failed:', err)
    } finally {
      setChecking(null)
    }
  }

  async function diagnoseArticle(article: TrackedArticle) {
    setDiagnosing(article.id)
    try {
      const res = await fetch('/api/rank/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: article.keyword,
          currentPosition: article.current_position,
          previousPosition: article.previous_position,
          positionChange: article.position_change,
          isCited: article.perplexity_cited,
          topCompetitor: article.top_competitor,
          articleId: article.id
        })
      })
      const data = await res.json()
      if (data.diagnosis) {
        setDiagnoses(prev => ({ ...prev, [article.id]: data.diagnosis }))
      }
    } catch (err) {
      console.error('Diagnosis failed:', err)
    } finally {
      setDiagnosing(null)
    }
  }

  function positionColor(pos: number | null) {
    if (!pos) return 'text-gray-400'
    if (pos <= 3) return 'text-green-600'
    if (pos <= 10) return 'text-blue-600'
    if (pos <= 30) return 'text-amber-600'
    return 'text-red-500'
  }

  function locationFlag(code: number): string {
    const found = LOCATION_OPTIONS.find(l => l.value === code)
    return found?.label.split(' ')[0] || '🌍'
  }

  function miniChart(history: TrackedArticle['rank_history'] = []) {
    if (!history || history.length < 2) return null
    const sorted = [...history]
      .sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime())
    const positions = sorted.map(h => h.position).filter((p): p is number => p !== null)
    if (positions.length < 2) return null

    const W = 80, H = 28
    const min = Math.min(...positions)
    const max = Math.max(...positions)
    const range = max - min || 1

    const pts = positions.map((p, i) => {
      const x = (i / (positions.length - 1)) * W
      const y = H - ((p - min) / range) * H
      return `${x},${y}`
    }).join(' ')

    const improving = positions[positions.length - 1] < positions[0]

    return (
      <svg width={W} height={H} className="ml-2 flex-shrink-0">
        <polyline
          points={pts}
          fill="none"
          stroke={improving ? '#1D9E75' : '#E24B4A'}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <IconLoader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Ranking Agent</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Tracks rankings globally — auto-checks weekly, auto-fixes on drops, digest every Monday.
          </p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setAddError(null) }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <IconPlus className="w-4 h-4" />
          Track article
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
          <p className="text-sm font-semibold text-gray-700">Add article to track</p>

          <input
            type="text"
            placeholder="Target keyword (e.g. best ev charger 2026)"
            value={form.keyword}
            onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400"
          />
          <input
            type="url"
            placeholder="Article URL (e.g. https://yoursite.com/blog/article)"
            value={form.articleUrl}
            onChange={e => setForm(f => ({ ...f, articleUrl: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400"
          />
          <input
            type="text"
            placeholder="Article title (optional)"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400"
          />

          <div>
            <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
              <IconGlobe className="w-3 h-3" /> Target country / market
            </label>
            <select
              value={form.locationCode}
              onChange={e => setForm(f => ({ ...f, locationCode: Number(e.target.value) }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400 bg-white"
            >
              {LOCATION_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={addArticle}
              disabled={adding || !form.keyword || !form.articleUrl}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              {adding ? 'Adding...' : 'Start tracking'}
            </button>
            <button
              onClick={() => { setShowForm(false); setAddError(null) }}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>

          {addError && (
            <p className="text-xs text-red-600 mt-1">{addError}</p>
          )}
        </div>
      )}

      {/* Empty state */}
      {articles.length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
          <IconTrendingUp className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No articles tracked yet</p>
          <p className="text-sm text-gray-400 mt-1">
            Add your first article — we will check its ranking every Monday automatically
          </p>
        </div>
      )}

      {/* Article cards */}
      <div className="space-y-3">
        {articles.map(article => (
          <div key={article.id} className="p-4 bg-white rounded-xl border border-gray-200 space-y-3">

            {/* Row 1: title + rank + chart */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {article.title || article.keyword}
                </p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{article.article_url}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <div className="text-right">
                  <div className={`text-2xl font-bold leading-none ${positionColor(article.current_position)}`}>
                    {article.current_position ? `#${article.current_position}` : '—'}
                  </div>
                  <div className="flex items-center justify-end gap-0.5 mt-0.5">
                    {article.position_change === null ? (
                      <IconMinus className="w-3 h-3 text-gray-300" />
                    ) : article.position_change > 0 ? (
                      <IconTrendingUp className="w-3 h-3 text-green-500" />
                    ) : article.position_change < 0 ? (
                      <IconTrendingDown className="w-3 h-3 text-red-500" />
                    ) : (
                      <IconMinus className="w-3 h-3 text-gray-400" />
                    )}
                    {article.position_change !== null && article.position_change !== 0 && (
                      <span className={`text-xs font-medium ${article.position_change > 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {article.position_change > 0 ? `+${article.position_change}` : article.position_change}
                      </span>
                    )}
                  </div>
                </div>
                {miniChart(article.rank_history)}
              </div>
            </div>

            {/* Row 2: keyword + location + competitor */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                🎯 {article.keyword}
              </span>
              <span className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-full">
                {locationFlag(article.location_code || 2840)} {
                  LOCATION_OPTIONS.find(l => l.value === (article.location_code || 2840))?.label.split(' ').slice(1).join(' ') || 'Global'
                }
              </span>
              {article.current_position && article.current_position <= 10 && (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
                  Page 1 ✓
                </span>
              )}
              {article.top_competitor && (
                <span className="text-xs text-gray-400">
                  vs <span className="text-gray-600 font-medium">{article.top_competitor}</span>
                </span>
              )}
            </div>

            {/* Row 3: signals + action buttons */}
            <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-gray-100">

              {/* AI citation */}
              {article.perplexity_cited === null ? (
                <span className="text-xs text-gray-400">AI citation: unchecked</span>
              ) : article.perplexity_cited ? (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <IconCheckCircle className="w-3 h-3" />
                  Cited by AI
                  {article.citation_share_of_voice !== null && (
                    <span className="text-green-500">({article.citation_share_of_voice}%)</span>
                  )}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-red-500">
                  <IconXCircle className="w-3 h-3" />
                  Not cited by AI
                  {article.cited_competitors?.length > 0 && (
                    <span className="text-gray-400 ml-1">
                      — {article.cited_competitors[0]} cited instead
                    </span>
                  )}
                </span>
              )}

              {/* Freshness */}
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                article.freshness_status === 'fresh'
                  ? 'bg-green-50 text-green-700'
                  : article.freshness_status === 'aging'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-red-50 text-red-700'
              }`}>
                {article.freshness_status}
              </span>

              {article.needs_refresh && (
                <span className="flex items-center gap-1 text-xs text-amber-600">
                  <IconAlertTriangle className="w-3 h-3" /> Refresh needed
                </span>
              )}

              {article.last_reoptimise_at && (
                <span className="text-xs text-purple-600">
                  Auto-fixed {new Date(article.last_reoptimise_at).toLocaleDateString('en-GB')}
                </span>
              )}

              {/* Action buttons */}
              <div className="ml-auto flex items-center gap-3">
                <button
                  onClick={() => diagnoseArticle(article)}
                  disabled={diagnosing === article.id}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-600 transition-colors disabled:opacity-50"
                >
                  {diagnosing === article.id
                    ? <IconLoader2 className="w-3 h-3 animate-spin" />
                    : <span>🧠</span>
                  }
                  {diagnosing === article.id ? 'Analysing...' : 'Diagnose'}
                </button>

                <button
                  onClick={() => checkNow(article)}
                  disabled={checking === article.id}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-orange-500 transition-colors disabled:opacity-50"
                >
                  {checking === article.id
                    ? <IconLoader2 className="w-3 h-3 animate-spin" />
                    : <IconRefreshCw className="w-3 h-3" />
                  }
                  {checking === article.id ? 'Checking...' : 'Check now'}
                </button>
              </div>
            </div>

            {/* AI Diagnosis panel */}
            {diagnoses[article.id] && (
              <div className="mt-1 p-3 bg-blue-50 rounded-lg border border-blue-100 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-blue-800">
                    AI Diagnosis
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    diagnoses[article.id].overallHealth === 'excellent' ? 'bg-green-100 text-green-700' :
                    diagnoses[article.id].overallHealth === 'good' ? 'bg-blue-100 text-blue-700' :
                    diagnoses[article.id].overallHealth === 'needs-work' ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {diagnoses[article.id].recommendedAction.replace(/-/g, ' ')}
                  </span>
                </div>
                <p className="text-xs text-blue-700">{diagnoses[article.id].reasoning}</p>
                {diagnoses[article.id].quickWins?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-blue-800 mb-1">Quick wins:</p>
                    {diagnoses[article.id].quickWins.map((win, i) => (
                      <p key={i} className="text-xs text-blue-700">• {win}</p>
                    ))}
                  </div>
                )}
                <p className="text-xs text-blue-500 italic">
                  Recovery estimate: {diagnoses[article.id].estimatedRecoveryTime}
                </p>
              </div>
            )}

            {/* Last checked */}
            {article.last_rank_check && (
              <p className="text-xs text-gray-400">
                Last checked {new Date(article.last_rank_check).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric'
                })} · Auto-checks every Monday 8am UTC
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

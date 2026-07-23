'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase-client'

function IconTrendingUp({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  )
}
function IconLoader({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
      <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
    </svg>
  )
}
function IconTarget({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  )
}

interface TrackedArticle {
  id: string
  keyword: string
  article_url: string
  current_position: number | null
  previous_position: number | null
  weekly_velocity: number | null
  predicted_weeks_to_page1: number | null
  predicted_date_to_page1: string | null
  velocity_confidence: string | null
}

export function VelocityPredictor() {
  const [articles, setArticles] = useState<TrackedArticle[]>([])
  const [predictions, setPredictions] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setLoading(false); return }

      const { data } = await supabase
        .from('ranking_agent_articles')
        .select('id, keyword, article_url, current_position, previous_position, weekly_velocity, predicted_weeks_to_page1, predicted_date_to_page1, velocity_confidence')
        .eq('user_id', session.user.id)
        .not('current_position', 'is', null)
        .order('current_position', { ascending: true })

      setArticles(data || [])
      setLoading(false)
    }
    load()
  }, [])

  async function predictVelocity(articleId: string, keyword: string) {
    setChecking(articleId)
    try {
      const res = await fetch('/api/rank/velocity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId, keyword, targetPosition: 10 }),
      })
      const data = await res.json()
      if (data.prediction) {
        setPredictions(prev => ({ ...prev, [articleId]: data.prediction }))
      }
    } catch (err) {
      console.error('Velocity prediction failed:', err)
    } finally {
      setChecking(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <span className="text-gray-400"><IconLoader className="w-5 h-5 animate-spin" /></span>
    </div>
  )

  if (articles.length === 0) return (
    <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
      <span className="text-gray-300 block mb-3"><IconTrendingUp className="w-10 h-10 mx-auto" /></span>
      <p className="text-gray-500 font-medium">No tracked articles with position data</p>
      <p className="text-sm text-gray-400 mt-1">Add articles to Rankings tab and run &quot;Check now&quot; first</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[#0F0F0F]">Rank Velocity Predictor</h2>
        <p className="text-sm text-[#6B6B6B] mt-0.5">
          Predicts how long to reach Page 1 based on your ranking trajectory.
          Needs at least 2 weekly rank checks per article.
        </p>
      </div>

      <div className="space-y-3">
        {articles.map(article => {
          const pred = predictions[article.id]
          const velocity = article.weekly_velocity || 0
          const isImproving = velocity > 0
          const weeksLeft = article.predicted_weeks_to_page1
          const isOnPage1 = article.current_position !== null && article.current_position <= 10
          const pos = article.current_position || 50

          return (
            <div key={article.id} className="bg-white rounded-xl border border-[#E8E8E4] p-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#0F0F0F] truncate">{article.keyword}</p>
                  <p className="text-xs text-[#6B6B6B] truncate mt-0.5">{article.article_url}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-2xl font-bold ${
                    isOnPage1 ? 'text-green-600' :
                    pos <= 20 ? 'text-blue-600' :
                    pos <= 30 ? 'text-amber-600' : 'text-red-500'
                  }`}>#{pos}</div>
                  <div className={`text-xs font-medium ${isImproving ? 'text-green-500' : velocity < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                    {velocity > 0 ? `↑${velocity}/wk` : velocity < 0 ? `↓${Math.abs(velocity)}/wk` : '→ stable'}
                  </div>
                </div>
              </div>

              {/* Velocity bar */}
              <div className="mb-3">
                <div className="flex justify-between text-xs text-[#6B6B6B] mb-1">
                  <span>Position 100</span>
                  <span>Page 1 (top 10)</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(5, 100 - (pos / 100) * 100)}%`,
                      background: isOnPage1 ? '#1D9E75' : '#FF6B2C',
                    }}
                  />
                </div>
              </div>

              {/* Prediction section */}
              {isOnPage1 ? (
                <div className="p-2.5 bg-green-50 rounded-lg border border-green-200 text-center">
                  <p className="text-sm font-medium text-green-700">On Page 1 — maintain freshness and schema</p>
                </div>
              ) : weeksLeft ? (
                <div className="p-2.5 bg-blue-50 rounded-lg border border-blue-100">
                  <p className="text-xs text-blue-700">
                    <span className="font-semibold">Predicted Page 1: </span>
                    {article.predicted_date_to_page1 || `~${weeksLeft} weeks`}
                    {article.velocity_confidence && (
                      <span className="text-blue-500 ml-1">({article.velocity_confidence} confidence)</span>
                    )}
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => predictVelocity(article.id, article.keyword)}
                  disabled={checking === article.id}
                  className="w-full text-sm text-[#FF6B2C] hover:text-[#E85A1E] border border-orange-200 py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {checking === article.id
                    ? <><span className="text-orange-400"><IconLoader className="w-3.5 h-3.5 animate-spin" /></span> Predicting...</>
                    : <><span><IconTarget className="w-3.5 h-3.5" /></span> Predict velocity</>
                  }
                </button>
              )}

              {/* What-if scenarios from live prediction */}
              {pred?.whatIfScenarios?.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-xs font-medium text-[#6B6B6B]">What-if scenarios:</p>
                  {pred.whatIfScenarios.slice(0, 2).map((scenario: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-[#6B6B6B] bg-[#FAFAF8] px-3 py-1.5 rounded-lg">
                      <span className="text-green-500 font-medium">+{scenario.estimatedBoost} pos</span>
                      <span className="flex-1">{scenario.action}</span>
                      {scenario.newPredictedWeeks && (
                        <span className="text-blue-500 flex-shrink-0">→ {scenario.newPredictedWeeks}wk</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

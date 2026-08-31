'use client'

import { useCallback, useEffect, useState } from 'react'
import { DashboardNav } from '@/components/DashboardNav'
import { createClient } from '@/lib/supabase/client'

interface Site {
  id: string
  domain: string
  brand: string
}

interface PromptRow {
  id: string
  prompt: string
}

interface RunRow {
  id: string
  started_at: string
  citation_rate: number | null
  mention_rate: number | null
  cost_usd: number | null
  cost_breakdown?: Record<string, number>
  status: string
  trigger: string
}

interface ResultRow {
  id: string
  prompt_text: string
  engine: string
  mentioned: boolean
  cited: boolean
  competitor_domains: string[]
  diagnostic: { finding?: string; status?: string; gaps?: string[] } | null
  cost_usd: number
  checked_at: string
}

export default function AiVisibilityPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState('')
  const [prompts, setPrompts] = useState<PromptRow[]>([])
  const [promptCap, setPromptCap] = useState(15)
  const [newPrompt, setNewPrompt] = useState('')
  const [runs, setRuns] = useState<RunRow[]>([])
  const [results, setResults] = useState<ResultRow[]>([])
  const [trend, setTrend] = useState<{
    citationRate: number | null
    previousCitationRate: number | null
    mentionRate: number | null
    costUsd: number | null
  } | null>(null)
  const [phaseNote, setPhaseNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data } = await supabase
        .from('connected_sites')
        .select('id, domain, brand')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })
      const list = data || []
      setSites(list)
      if (list[0]) setSiteId(list[0].id)
    })
  }, [])

  const load = useCallback(async (id: string) => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [pRes, rRes] = await Promise.all([
        fetch(`/api/copilot/ai-visibility/prompts?siteId=${encodeURIComponent(id)}`),
        fetch(`/api/copilot/ai-visibility/run?siteId=${encodeURIComponent(id)}`),
      ])
      const pJson = await pRes.json()
      const rJson = await rRes.json()
      if (!pRes.ok) throw new Error(pJson.error || 'Failed to load prompts')
      if (!rRes.ok) throw new Error(rJson.error || 'Failed to load runs')
      setPrompts(pJson.prompts || [])
      setPromptCap(pJson.promptCap || 15)
      setRuns(rJson.runs || [])
      setResults(rJson.latestResults || [])
      setTrend(rJson.trend || null)
      setPhaseNote(rJson.phaseNote || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (siteId) void load(siteId)
  }, [siteId, load])

  async function addPrompt() {
    if (!siteId || !newPrompt.trim()) return
    const res = await fetch('/api/copilot/ai-visibility/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, prompt: newPrompt.trim() }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error || 'Could not add prompt')
      return
    }
    setNewPrompt('')
    await load(siteId)
  }

  async function runCheck() {
    if (!siteId) return
    setRunning(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/copilot/ai-visibility/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, trigger: 'manual' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message || json.error || 'Run failed')
      setMessage(
        `${json.message} Citation rate ${json.citationRate}% · cost $${Number(json.costUsd || 0).toFixed(4)}`,
      )
      setPhaseNote(json.phaseNote || phaseNote)
      await load(siteId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed')
    } finally {
      setRunning(false)
    }
  }

  const trendDelta =
    trend?.citationRate != null && trend?.previousCitationRate != null
      ? Number(trend.citationRate) - Number(trend.previousCitationRate)
      : null

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <h1 className="text-2xl font-semibold mb-2">AI Visibility</h1>
          <p className="text-[#6B6B6B] mb-2">
            Check whether ChatGPT and Perplexity mention or cite your connected site for prompts you care about — then link gaps to real page signals (schema, freshness, answer-first).
          </p>
          {phaseNote && (
            <p className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1.5 mb-6">{phaseNote}</p>
          )}

          {sites.length === 0 ? (
            <p className="text-sm text-[#6B6B6B]">
              Connect a site in Settings → Your Sites first. Citation checks only run for sites you own.
            </p>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  className="border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white"
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                >
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.brand} ({s.domain})
                    </option>
                  ))}
                </select>
                <button
                  onClick={runCheck}
                  disabled={running || !siteId}
                  className="px-4 py-2 rounded-lg bg-[#FF6B2C] text-white disabled:opacity-50"
                >
                  {running ? 'Checking…' : 'Run citation check'}
                </button>
              </div>

              {error && <p className="text-red-600">{error}</p>}
              {message && <p className="text-sm text-[#0F0F0F]">{message}</p>}
              {loading && <p className="text-sm text-[#9B9B9B]">Loading…</p>}

              {trend && (
                <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-2xl font-semibold">{trend.citationRate ?? '—'}%</div>
                    <div className="text-xs text-[#9B9B9B]">Citation rate</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">
                      {trendDelta == null ? '—' : `${trendDelta > 0 ? '+' : ''}${trendDelta.toFixed(1)}`}
                    </div>
                    <div className="text-xs text-[#9B9B9B]">vs last run</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{trend.mentionRate ?? '—'}%</div>
                    <div className="text-xs text-[#9B9B9B]">Mention rate</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">${Number(trend.costUsd || 0).toFixed(4)}</div>
                    <div className="text-xs text-[#9B9B9B]">Last run cost (USD)</div>
                  </div>
                </div>
              )}

              <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white">
                <h2 className="font-medium mb-2">Tracked prompts ({prompts.length}/{promptCap})</h2>
                <ul className="text-sm space-y-1 mb-3">
                  {prompts.map((p) => (
                    <li key={p.id} className="text-[#6B6B6B]">{p.prompt}</li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <input
                    className="flex-1 border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white"
                    placeholder="Add a realistic customer prompt"
                    value={newPrompt}
                    onChange={(e) => setNewPrompt(e.target.value)}
                  />
                  <button
                    onClick={addPrompt}
                    className="px-3 py-2 rounded-lg border border-[#E5E5E5] bg-white"
                  >
                    Add
                  </button>
                </div>
              </div>

              {results.length > 0 && (
                <div>
                  <h2 className="font-medium mb-2">Latest results</h2>
                  <ul className="space-y-2">
                    {results.map((r) => (
                      <li key={r.id} className="border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white text-sm">
                        <div className="flex flex-wrap gap-2 items-baseline">
                          <span className="font-medium">{r.prompt_text}</span>
                          <span className="text-xs uppercase text-[#9B9B9B]">{r.engine}</span>
                          <span className={r.cited ? 'text-green-700' : r.mentioned ? 'text-amber-700' : 'text-[#6B6B6B]'}>
                            {r.cited ? 'Cited' : r.mentioned ? 'Mentioned' : 'Not cited'}
                          </span>
                          <span className="text-xs text-[#9B9B9B]">${Number(r.cost_usd || 0).toFixed(4)}</span>
                        </div>
                        {r.diagnostic?.finding && (
                          <p className="text-[#6B6B6B] mt-1">{r.diagnostic.finding}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {runs.length > 0 && (
                <div>
                  <h2 className="font-medium mb-2">Run history</h2>
                  <ul className="text-sm text-[#6B6B6B] space-y-1">
                    {runs.map((r) => (
                      <li key={r.id}>
                        {new Date(r.started_at).toLocaleString()} — citation {r.citation_rate ?? '—'}% · cost $
                        {Number(r.cost_usd || 0).toFixed(4)} · {r.trigger} · {r.status}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { DashboardNav } from '@/components/DashboardNav'

type BriefMode = 'content' | 'product' | 'category'

interface BriefSection {
  heading: string
  level: string
  guidance: string
  primaryKeywordPlacement?: string
  secondaryKeywordPlacement?: string
  needsCitation: boolean
  citationNote?: string
}

interface BriefPayload {
  seedKeyword: string
  market: string
  brief: {
    mode: BriefMode
    seedKeyword: string
    suggestedTitle: string
    intent: string
    strategistNotes: string[]
    sections: BriefSection[]
    strippedInventedClaims: boolean
  }
}

export default function BriefsPage() {
  const [seed, setSeed] = useState('')
  const [mode, setMode] = useState<BriefMode | ''>('')
  const [market, setMarket] = useState('Global')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<BriefPayload | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/copilot/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seedKeyword: seed,
          market,
          mode: mode || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <h1 className="text-2xl font-semibold mb-2">Content Brief</h1>
          <p className="text-[#6B6B6B] mb-6">
            Enter a seed keyword or topic. SEORANKO builds a strategist brief — H1/H2 structure, section guidance, and “needs real source” flags. No invented prices, stock claims, or specs.
          </p>

          <div className="grid gap-3 mb-6">
            <input
              className="border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white"
              placeholder="Seed keyword or topic"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <select
                className="border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white"
                value={mode}
                onChange={(e) => setMode(e.target.value as BriefMode | '')}
              >
                <option value="">Auto-detect mode</option>
                <option value="content">Content brief</option>
                <option value="product">Product description brief</option>
                <option value="category">Category page brief</option>
              </select>
              <input
                className="border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white"
                placeholder="Market (e.g. UK, US, Global)"
                value={market}
                onChange={(e) => setMarket(e.target.value)}
              />
              <button
                onClick={run}
                disabled={loading || !seed.trim()}
                className="px-4 py-2 rounded-lg bg-[#FF6B2C] text-white disabled:opacity-50"
              >
                {loading ? 'Building brief…' : 'Generate brief'}
              </button>
            </div>
          </div>

          {error && <p className="text-red-600 mb-4">{error}</p>}

          {data && (
            <div className="space-y-6">
              <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white">
                <div className="text-xs uppercase text-[#9B9B9B]">
                  {data.brief.mode} brief · seed “{data.brief.seedKeyword || data.seedKeyword}”
                  {data.brief.strippedInventedClaims ? ' · invented claims stripped' : ''}
                </div>
                <h2 className="text-xl font-semibold mt-1">{data.brief.suggestedTitle}</h2>
                <p className="text-sm text-[#6B6B6B] mt-1">Intent: {data.brief.intent}</p>
                <ul className="mt-3 text-sm text-[#6B6B6B] list-disc pl-5 space-y-1">
                  {data.brief.strategistNotes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>

                <div className="mt-6 space-y-4">
                  {data.brief.sections.map((s) => (
                    <div key={s.heading + s.level} className="border-t border-[#F0F0F0] pt-3">
                      <div className="text-xs text-[#9B9B9B] uppercase">{s.level}</div>
                      <div className="font-medium">{s.heading}</div>
                      <p className="text-sm text-[#6B6B6B] mt-1">{s.guidance}</p>
                      {(s.primaryKeywordPlacement || s.secondaryKeywordPlacement) && (
                        <p className="text-xs mt-1 text-[#0F0F0F]">
                          Placement: {[s.primaryKeywordPlacement, s.secondaryKeywordPlacement].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {s.needsCitation && (
                        <p className="text-xs mt-1 text-amber-700">
                          Needs real source: {s.citationNote || 'Add an official citation before publishing.'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

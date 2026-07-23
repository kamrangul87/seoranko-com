'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react'

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
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
function IconTrendingUp({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
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
function IconShoppingCart({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
    </svg>
  )
}
function IconMapPin({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  )
}

const LOCATIONS = [
  { value: 2840, label: 'Global / US' },
  { value: 2826, label: 'United Kingdom' },
  { value: 2036, label: 'Australia' },
  { value: 2356, label: 'India' },
  { value: 2784, label: 'UAE' },
]

type ContentType = 'informational' | 'product' | 'service' | 'comparison'

const intentConfig = (intent: string) => ({
  informational: { color: 'text-blue-600',  bg: 'bg-blue-50',  border: 'border-blue-200',  Icon: IconTrendingUp },
  commercial:    { color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', Icon: IconTarget },
  transactional: { color: 'text-red-600',   bg: 'bg-red-50',   border: 'border-red-200',   Icon: IconShoppingCart },
  navigational:  { color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', Icon: IconMapPin },
}[intent] || { color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200', Icon: IconSearch })

export function SERPIntentAnalyser() {
  const [keyword, setKeyword]       = useState('')
  const [location, setLocation]     = useState(2840)
  const [contentType, setContentType] = useState<ContentType>('informational')
  const [loading, setLoading]       = useState(false)
  const [result, setResult]         = useState<any>(null)
  const [error, setError]           = useState<string | null>(null)

  async function analyse() {
    if (!keyword.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/serp-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), locationCode: location, userContentType: contentType }),
      })
      const data = await res.json()
      if (data.success) setResult(data.result)
      else setError(data.error || 'Analysis failed')
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[#0F0F0F]">SERP Intent Analyser</h2>
        <p className="text-sm text-[#6B6B6B] mt-0.5">
          Checks what Google actually shows for a keyword before you write.
          Detects if your content type can realistically rank.
        </p>
      </div>

      {/* Input form */}
      <div className="bg-white rounded-xl border border-[#E8E8E4] p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyse()}
            placeholder="e.g. best ev charger uk 2026"
            className="flex-1 px-3 py-2.5 text-sm border border-[#E8E8E4] rounded-[8px] bg-[#FAFAF8] focus:outline-none focus:border-[#FF6B2C]/50"
          />
          <select
            value={location}
            onChange={e => setLocation(Number(e.target.value))}
            className="px-3 py-2.5 text-sm border border-[#E8E8E4] rounded-[8px] bg-[#FAFAF8] focus:outline-none focus:border-[#FF6B2C]/50"
          >
            {LOCATIONS.map(l => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>

        <div>
          <p className="text-xs text-[#6B6B6B] mb-2">My content type:</p>
          <div className="flex gap-2 flex-wrap">
            {(['informational', 'product', 'service', 'comparison'] as ContentType[]).map(type => (
              <button
                key={type}
                onClick={() => setContentType(type)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium capitalize transition-colors ${
                  contentType === type
                    ? 'bg-[#FF6B2C] text-white border-[#FF6B2C]'
                    : 'border-[#E8E8E4] text-[#6B6B6B] hover:border-gray-300 bg-[#FAFAF8]'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={analyse}
          disabled={loading || !keyword.trim()}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#FF6B2C] hover:bg-[#E85A1E] text-[#0a0a0a] text-sm font-semibold rounded-[8px] disabled:opacity-50 transition-colors"
        >
          {loading
            ? <><span><IconLoader className="w-4 h-4 animate-spin" /></span> Analysing live SERP...</>
            : <><span><IconSearch className="w-4 h-4" /></span> Analyse SERP intent</>
          }
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {/* Results */}
      {result && (() => {
        const cfg = intentConfig(result.intent)
        const IntentIcon = cfg.Icon
        return (
          <div className="space-y-4">
            {/* Intent verdict */}
            <div className={`p-4 rounded-xl border ${cfg.bg} ${cfg.border}`}>
              <div className="flex items-center justify-between mb-2">
                <div className={`flex items-center gap-2 ${cfg.color}`}>
                  <IntentIcon className="w-5 h-5" />
                  <span className="font-semibold capitalize">{result.intent} intent</span>
                  <span className="text-xs opacity-70">({result.confidence}% confident)</span>
                </div>
                <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                  result.canUserArticleRank
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  {result.canUserArticleRank ? 'Can rank' : `Ceiling ~#${result.ceiling}`}
                </span>
              </div>
              <p className="text-sm leading-relaxed">{result.recommendation}</p>
            </div>

            {/* SERP composition */}
            <div className="bg-white rounded-xl border border-[#E8E8E4] p-4">
              <p className="text-sm font-semibold text-[#0F0F0F] mb-2">
                What Google shows for &quot;{result.keyword}&quot;
              </p>
              <p className="text-xs text-[#6B6B6B] mb-3">{result.serpEvidence}</p>
              <div className="grid grid-cols-3 gap-2">
                {result.topResultTypes.map((type: string, i: number) => (
                  <div key={i} className="text-center p-2 bg-[#FAFAF8] rounded-lg">
                    <div className="text-sm font-medium text-[#0F0F0F] capitalize">{type}</div>
                    <div className="text-xs text-[#6B6B6B] mt-0.5">#{i + 1} type</div>
                  </div>
                ))}
              </div>
            </div>

            {/* SERP features */}
            {result.serpFeatures?.length > 0 && (
              <div className="bg-white rounded-xl border border-[#E8E8E4] p-4">
                <p className="text-sm font-semibold text-[#0F0F0F] mb-2">SERP features present</p>
                <div className="flex flex-wrap gap-2">
                  {result.serpFeatures.map((feature: string, i: number) => (
                    <span key={i} className="text-xs bg-orange-50 text-orange-700 border border-orange-200 px-2 py-1 rounded-full">
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

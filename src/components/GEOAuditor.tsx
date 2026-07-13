'use client'
import { useState } from 'react'

interface GEOAuditSignal {
  id: string; name: string; score: number; grade: string
  status: 'pass' | 'warn' | 'fail'; weight: number
  finding: string; fix: string; effort: string; impact: string
}

interface GEOAuditResult {
  url: string; auditedAt: string; compositeScore: number; grade: string
  signals: GEOAuditSignal[]; topFixes: string[]; estimatedCitabilityGain: string
}

export function GEOAuditor() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GEOAuditResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null)

  async function handleAudit() {
    if (!url) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/geo-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      setResult(data.result)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const scoreColor = (score: number) =>
    score >= 80 ? '#1D9E75' : score >= 60 ? '#BA7517' : '#E24B4A'

  function StatusIcon({ status }: { status: string }) {
    if (status === 'pass') return <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    if (status === 'warn') return <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
    return <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
  }

  const impactColors: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-gray-100 text-gray-600'
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">GEO Site Auditor</h2>
        <p className="text-sm text-gray-500 mt-1">
          8-signal AI readiness score for any URL. Checks bot access, schema, llms.txt, author signals, content freshness, fact density, heading structure, and authority links.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAudit()}
          placeholder="https://yoursite.com/your-article"
          className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400"
        />
        <button
          onClick={handleAudit}
          disabled={loading || !url}
          className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-xl disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          )}
          {loading ? 'Auditing...' : 'Audit'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Composite score */}
          <div className="p-5 rounded-2xl border-2" style={{ borderColor: scoreColor(result.compositeScore) + '40', background: scoreColor(result.compositeScore) + '08' }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm text-gray-500">GEO Readiness Score</p>
                <p className="text-xs text-gray-400 mt-0.5 break-all">{result.url}</p>
              </div>
              <div className="text-right">
                <div className="text-5xl font-bold" style={{ color: scoreColor(result.compositeScore) }}>
                  {result.compositeScore}
                </div>
                <div className="text-sm font-medium" style={{ color: scoreColor(result.compositeScore) }}>
                  Grade {result.grade}
                </div>
              </div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="h-2 rounded-full transition-all duration-700"
                style={{ width: `${result.compositeScore}%`, background: scoreColor(result.compositeScore) }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">{result.estimatedCitabilityGain}</p>
          </div>

          {/* Signal grid */}
          <div className="grid grid-cols-4 gap-2">
            {result.signals.map(signal => (
              <div
                key={signal.id}
                className="p-2.5 bg-gray-50 rounded-lg border border-gray-200 text-center cursor-pointer hover:border-gray-300 transition-colors"
                onClick={() => setExpandedSignal(expandedSignal === signal.id ? null : signal.id)}
              >
                <div className="text-xl font-bold" style={{ color: scoreColor(signal.score) }}>
                  {signal.score}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 leading-tight">{signal.name}</div>
                <div className="flex justify-center mt-1"><StatusIcon status={signal.status} /></div>
              </div>
            ))}
          </div>

          {/* Expanded signal detail */}
          {expandedSignal && (() => {
            const sig = result.signals.find(s => s.id === expandedSignal)
            if (!sig) return null
            return (
              <div className="p-4 bg-white rounded-xl border border-gray-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={sig.status} />
                    <span className="font-medium text-sm text-gray-900">{sig.name}</span>
                    <span className="text-2xl font-bold" style={{ color: scoreColor(sig.score) }}>{sig.score}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${impactColors[sig.impact] || impactColors.low}`}>{sig.impact}</span>
                    <span className="text-xs text-gray-400">{sig.effort} effort</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Finding</p>
                  <p className="text-sm text-gray-700">{sig.finding}</p>
                </div>
                {sig.status !== 'pass' && (
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <p className="text-xs font-medium text-blue-700 mb-1">How to fix</p>
                    <p className="text-sm text-blue-800 whitespace-pre-line">{sig.fix}</p>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Top fixes */}
          {result.topFixes.length > 0 && (
            <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
              <p className="text-sm font-semibold text-amber-900 mb-3">Priority fixes — highest impact first</p>
              <ol className="space-y-2">
                {result.topFixes.map((fix, i) => (
                  <li key={i} className="flex gap-2 text-xs text-amber-800">
                    <span className="font-bold flex-shrink-0">{i + 1}.</span>
                    <span>{fix}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="text-xs text-gray-400 text-center">
            Audited {new Date(result.auditedAt).toLocaleString('en-GB')} · Results saved to your audit history
          </p>
        </div>
      )}
    </div>
  )
}

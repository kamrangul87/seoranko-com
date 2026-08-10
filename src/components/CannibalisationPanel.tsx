'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CannibalPair, CannibalResult } from '@/lib/cannibalization-detector'

// Inline SVG icons (lucide-react not installed)
function IconAlertTriangle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
function IconLoader({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  )
}
function IconGitMerge({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  )
}
function IconArrowRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

export function CannibalisationPanel() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CannibalResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runCheck() {
    setLoading(true)
    setError(null)
    try {
      // The route authenticates from the session cookie — same pattern as the
      // other panels, no Bearer header needed.
      const res = await fetch('/api/cannibalization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      })
      const data = await res.json()
      if (res.ok && data.success) setResult(data.result)
      else setError(data.error || 'Check failed')
    } catch {
      setError('Could not run the check — try again')
    } finally {
      setLoading(false)
    }
  }

  const severityColor = (s: string) => ({
    high: 'bg-red-50 border-red-200',
    medium: 'bg-amber-50 border-amber-200',
    low: 'bg-gray-50 border-gray-200'
  }[s] || 'bg-gray-50 border-gray-200')

  if (!result) {
    return (
      <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
        <IconAlertTriangle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h3 className="text-base font-semibold text-gray-800 mb-1">Keyword Cannibalisation Detector</h3>
        <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
          Finds articles competing for the same keywords and recommends whether to merge or differentiate them.
        </p>
        <button
          onClick={runCheck}
          disabled={loading}
          className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-xl disabled:opacity-50 transition-colors"
        >
          {loading ? <IconLoader className="w-4 h-4 animate-spin" /> : <IconGitMerge className="w-4 h-4" />}
          {loading ? 'Checking your articles…' : 'Run cannibalisation check'}
        </button>
        {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            {result.totalConflicts} conflict{result.totalConflicts !== 1 ? 's' : ''} found
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">{result.topAction}</p>
        </div>
        <button
          onClick={runCheck}
          disabled={loading}
          className="text-sm text-gray-500 hover:text-orange-500 disabled:opacity-50 flex-shrink-0 transition-colors"
        >
          {loading ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {result.pairs.length === 0 ? (
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
          ✓ No cannibalisation detected — your articles target distinct keywords.
        </div>
      ) : (
        result.pairs.map((pair: CannibalPair, i: number) => (
          <div key={i} className={`p-4 rounded-xl border ${severityColor(pair.severity)}`}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-xs font-semibold uppercase text-gray-700">
                {pair.severity} severity · {pair.overlapScore}% overlap
              </span>
              <span className="text-xs font-medium capitalize px-2 py-0.5 bg-white rounded-full text-gray-700 flex-shrink-0">
                {pair.recommendation}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-800 mb-2">
              <span className="truncate">{pair.article1Title}</span>
              <IconArrowRight className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
              <span className="truncate">{pair.article2Title}</span>
            </div>
            <div className="text-xs text-gray-500 mb-2">
              <span className="font-medium">{pair.article1Keyword}</span>
              {' vs '}
              <span className="font-medium">{pair.article2Keyword}</span>
            </div>
            <p className="text-xs text-gray-600 mb-2">{pair.fixPlan}</p>
            {pair.recommendation === 'differentiate' && (
              <button
                onClick={() => router.push(`/dashboard/improve?articleId=${encodeURIComponent(pair.article1Id)}&instruction=${encodeURIComponent(pair.fixPlan)}`)}
                className="text-xs font-medium text-orange-600 hover:text-orange-700"
              >
                Differentiate &ldquo;{pair.article1Title}&rdquo; now →
              </button>
            )}
          </div>
        ))
      )}
    </div>
  )
}

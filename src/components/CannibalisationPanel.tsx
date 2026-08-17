'use client'
import { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase-client'
import type { CannibalPair, CannibalResult } from '@/lib/cannibalization-detector'

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

async function authHeaders(): Promise<HeadersInit | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return null
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }
}

type CannibalApiPayload = {
  success?: boolean
  result?: CannibalResult | null
  error?: string
}

async function parseJson(res: Response): Promise<{ ok: boolean; status: number; data: CannibalApiPayload }> {
  const text = await res.text()
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) as CannibalApiPayload }
  } catch {
    return {
      ok: false,
      status: res.status,
      data: { error: `Check failed (${res.status}) — server returned a non-JSON response` },
    }
  }
}

function pairKey(pair: CannibalPair): string {
  return [pair.article1Id, pair.article2Id].sort().join(':')
}

function buildBrief(pair: CannibalPair): string {
  return [
    `Conflict: ${pair.article1Title}`,
    `  Keyword: ${pair.article1Keyword}`,
    `vs`,
    `  ${pair.article2Title}`,
    `  Keyword: ${pair.article2Keyword}`,
    ``,
    `Overlap: ${pair.overlapScore}% · Severity: ${pair.severity}`,
    `Recommended: ${pair.recommendation.toUpperCase()}`,
    ``,
    `What to do:`,
    pair.fixPlan,
  ].join('\n')
}

type FilterMode = 'priority' | 'all'

const PAGE_SIZE = 8

export function CannibalisationPanel() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [result, setResult] = useState<CannibalResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterMode>('priority')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    async function loadSaved() {
      try {
        const headers = await authHeaders()
        if (!headers) { setInitialLoading(false); return }
        const res = await fetch('/api/cannibalization', {
          headers,
          credentials: 'include',
        })
        const { data } = await parseJson(res)
        if (!cancelled && data.success && data.result) setResult(data.result)
      } catch {
        // Fall through to empty state
      } finally {
        if (!cancelled) setInitialLoading(false)
      }
    }
    loadSaved()
    return () => { cancelled = true }
  }, [])

  async function runCheck() {
    setLoading(true)
    setError(null)
    setVisibleCount(PAGE_SIZE)
    setDismissed(new Set())
    try {
      const headers = await authHeaders()
      if (!headers) {
        setError('Not logged in — refresh the page and try again')
        return
      }
      const res = await fetch('/api/cannibalization', {
        method: 'POST',
        headers,
        credentials: 'include',
      })
      const { ok, data } = await parseJson(res)
      if (ok && data.success && data.result) {
        setResult(data.result)
      } else {
        setError(data.error || 'Check failed')
      }
    } catch (err) {
      setError(String(err) || 'Could not run the check — try again')
    } finally {
      setLoading(false)
    }
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1800)
    } catch {
      setError('Could not copy — allow clipboard access in the browser, or select the text manually')
    }
  }

  const filteredPairs = useMemo(() => {
    if (!result) return []
    return result.pairs.filter(p => {
      if (dismissed.has(pairKey(p))) return false
      if (filter === 'priority') return p.severity === 'high' || p.recommendation === 'merge'
      return true
    })
  }, [result, filter, dismissed])

  const visiblePairs = filteredPairs.slice(0, visibleCount)
  const highCount = result?.pairs.filter(p => p.severity === 'high').length ?? 0
  const mergeCount = result?.pairs.filter(p => p.recommendation === 'merge').length ?? 0

  function openImprove(articleId: string, instruction: string) {
    router.push(`/dashboard/improve?articleId=${encodeURIComponent(articleId)}&instruction=${encodeURIComponent(instruction)}`)
  }

  function openKeywords(keyword: string) {
    router.push(`/dashboard/keywords?q=${encodeURIComponent(keyword)}`)
  }

  if (initialLoading && !result) {
    return (
      <div className="text-center py-16 text-sm text-gray-400 flex items-center justify-center gap-2">
        <IconLoader className="w-4 h-4 animate-spin" />
        Loading last check…
      </div>
    )
  }

  if (!result) {
    return (
      <div className="space-y-4">
        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
          <h3 className="text-base font-semibold text-gray-900">How cannibalisation works</h3>
          <ol className="space-y-2 text-sm text-gray-600">
            <li><span className="font-medium text-gray-800">1. We scan your articles</span> for overlapping keywords and titles.</li>
            <li><span className="font-medium text-gray-800">2. Each conflict gets a clear action</span> — Merge (keep one page) or Differentiate (rewrite one).</li>
            <li><span className="font-medium text-gray-800">3. You copy the brief or open Improve</span> to apply the rewrite in one click.</li>
          </ol>
        </div>
        <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-2xl">
          <IconAlertTriangle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-gray-800 mb-1">Keyword conflict check</h3>
          <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
            Find pages fighting for the same search, then copy a fix brief or open Improve to rewrite one of them.
          </p>
          <button
            onClick={runCheck}
            disabled={loading}
            className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-xl disabled:opacity-50 transition-colors"
          >
            {loading ? <IconLoader className="w-4 h-4 animate-spin" /> : <IconGitMerge className="w-4 h-4" />}
            {loading ? 'Checking your articles…' : 'Run cannibalisation check'}
          </button>
          {error && <p className="text-xs text-red-600 mt-3 px-6 break-words">{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* How to use */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-xs text-gray-600 space-y-1">
        <p className="font-medium text-gray-800">How to use this list</p>
        <p>Start with <span className="font-medium">Priority</span> conflicts. For each card: <span className="font-medium">Copy brief</span> to paste into notes/CMS, or tap the orange button to act in Improve.</p>
        <p>Dismiss hides a conflict you already handled. It does not delete articles.</p>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">
            {result.totalConflicts} conflict{result.totalConflicts !== 1 ? 's' : ''} found
          </h3>
          <p className="text-sm text-gray-600 mt-1">{result.topAction}</p>
          <p className="text-xs text-gray-400 mt-1">
            {highCount} high severity · {mergeCount} suggested merges
            {result.checkedAt ? ` · Checked ${new Date(result.checkedAt).toLocaleString('en-GB')}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => copyText('top', result.topAction)}
            className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-gray-700 hover:border-orange-300 hover:text-orange-700 bg-white"
          >
            {copiedKey === 'top' ? 'Copied ✓' : 'Copy top action'}
          </button>
          <button
            onClick={runCheck}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-gray-700 hover:text-orange-600 disabled:opacity-50 bg-white"
          >
            {loading ? 'Checking…' : 'Re-check'}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 break-words">{error}</p>}

      {/* Filters */}
      <div className="flex gap-2">
        <button
          onClick={() => { setFilter('priority'); setVisibleCount(PAGE_SIZE) }}
          className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
            filter === 'priority' ? 'bg-orange-500 text-white' : 'bg-white border border-gray-200 text-gray-600'
          }`}
        >
          Priority first
        </button>
        <button
          onClick={() => { setFilter('all'); setVisibleCount(PAGE_SIZE) }}
          className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
            filter === 'all' ? 'bg-orange-500 text-white' : 'bg-white border border-gray-200 text-gray-600'
          }`}
        >
          Show all ({result.pairs.length - dismissed.size})
        </button>
      </div>

      {result.pairs.length === 0 ? (
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
          ✓ No cannibalisation detected — your articles target distinct keywords.
        </div>
      ) : filteredPairs.length === 0 ? (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-600">
          No priority conflicts left in this filter. Switch to “Show all”, or re-check after you fix more articles.
        </div>
      ) : (
        <div className="space-y-3">
          {visiblePairs.map((pair, i) => {
            const key = pairKey(pair)
            const brief = buildBrief(pair)
            const isMerge = pair.recommendation === 'merge'
            return (
              <div
                key={key}
                className={`rounded-xl border bg-white overflow-hidden ${
                  pair.severity === 'high' ? 'border-red-200' : pair.severity === 'medium' ? 'border-amber-200' : 'border-gray-200'
                }`}
              >
                <div className={`px-4 py-2 flex flex-wrap items-center gap-2 text-xs font-medium ${
                  pair.severity === 'high' ? 'bg-red-50 text-red-800' : pair.severity === 'medium' ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-700'
                }`}>
                  <span className="uppercase tracking-wide">{pair.severity} severity</span>
                  <span className="text-gray-400">·</span>
                  <span>{pair.overlapScore}% overlap</span>
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-white border border-black/5 capitalize text-gray-800">
                    Recommend: {pair.recommendation}
                  </span>
                </div>

                <div className="p-4 space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Article A — keep or rewrite</p>
                      <p className="text-sm font-medium text-gray-900 leading-snug">{pair.article1Title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <code className="text-xs bg-white border border-gray-200 px-2 py-0.5 rounded text-gray-700">
                          {pair.article1Keyword}
                        </code>
                        <button
                          onClick={() => copyText(`kw1-${i}`, pair.article1Keyword)}
                          className="text-xs font-medium text-orange-600 hover:text-orange-700"
                        >
                          {copiedKey === `kw1-${i}` ? 'Copied' : 'Copy keyword'}
                        </button>
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Article B — competing page</p>
                      <p className="text-sm font-medium text-gray-900 leading-snug">{pair.article2Title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <code className="text-xs bg-white border border-gray-200 px-2 py-0.5 rounded text-gray-700">
                          {pair.article2Keyword}
                        </code>
                        <button
                          onClick={() => copyText(`kw2-${i}`, pair.article2Keyword)}
                          className="text-xs font-medium text-orange-600 hover:text-orange-700"
                        >
                          {copiedKey === `kw2-${i}` ? 'Copied' : 'Copy keyword'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-orange-100 bg-orange-50/60 px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-orange-700 font-semibold mb-1">What to do next</p>
                    <p className="text-sm text-gray-800 leading-relaxed">{pair.fixPlan}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => copyText(`brief-${i}`, brief)}
                      className="px-3 py-2 text-xs font-medium rounded-lg bg-orange-500 hover:bg-orange-600 text-white"
                    >
                      {copiedKey === `brief-${i}` ? 'Brief copied ✓' : 'Copy full brief'}
                    </button>
                    <button
                      onClick={() => copyText(`fix-${i}`, pair.fixPlan)}
                      className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:border-orange-300"
                    >
                      {copiedKey === `fix-${i}` ? 'Copied ✓' : 'Copy fix only'}
                    </button>
                    {isMerge ? (
                      <button
                        onClick={() => openImprove(
                          pair.article2Id,
                          `MERGE PLAN: Keep “${pair.article1Title}” as the winner. Fold unique points from “${pair.article2Title}” into it, then redirect the weaker URL. ${pair.fixPlan}`
                        )}
                        className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-800 hover:border-orange-300"
                      >
                        Open merge plan in Improve →
                      </button>
                    ) : (
                      <button
                        onClick={() => openImprove(pair.article1Id, pair.fixPlan)}
                        className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-800 hover:border-orange-300"
                      >
                        Differentiate in Improve →
                      </button>
                    )}
                    <button
                      onClick={() => openKeywords(pair.article1Keyword)}
                      className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:text-orange-600"
                    >
                      Research keyword →
                    </button>
                    <button
                      onClick={() => setDismissed(prev => new Set(prev).add(key))}
                      className="px-3 py-2 text-xs font-medium rounded-lg text-gray-400 hover:text-red-600 ml-auto"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          {visibleCount < filteredPairs.length && (
            <button
              onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
              className="w-full py-2.5 text-sm font-medium text-orange-600 hover:text-orange-700 border border-dashed border-orange-200 rounded-xl bg-orange-50/40"
            >
              Show more ({filteredPairs.length - visibleCount} left)
            </button>
          )}
        </div>
      )}

      {dismissed.size > 0 && (
        <button
          onClick={() => setDismissed(new Set())}
          className="text-xs text-gray-500 hover:text-orange-600"
        >
          Restore {dismissed.size} dismissed conflict{dismissed.size === 1 ? '' : 's'}
        </button>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { DashboardNav } from '@/components/DashboardNav'

interface AuditIssue {
  id: string
  severity: string
  category: string
  title: string
  description: string
  remediation?: string
}

interface AuditResult {
  url: string
  score: number
  searchScore: number
  aiScore: number
  httpStatus: number
  siteType: {
    siteType: string
    confidence: string
    signals: string[]
    pageRole: string | null
  }
  issues: AuditIssue[]
  opportunities: string[]
  explainable: {
    dimensions: Array<{ id: string; label: string; status: string; summary: string }>
    score: number
    scoreExplanation: string
    publishDecision: string
    publishDecisionReason: string
  }
  signals: {
    title: string
    h1: string
    wordCount: number
    hasSchema: boolean
    hasProductSchema: boolean
  }
  history: Array<{ auditedAt: string; score: number }>
  crawlNotes: string[]
}

export default function AuditPage() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [audit, setAudit] = useState<AuditResult | null>(null)

  async function runAudit() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/copilot/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Audit failed')
      setAudit(data.audit)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <h1 className="text-2xl font-semibold mb-2">Site Audit</h1>
          <p className="text-[#6B6B6B] mb-6">
            Paste a URL. SEORANKO crawls the page, detects content vs e-commerce, and returns the Quality Gate dimension report — plus e-commerce checks when relevant.
          </p>

          <div className="flex gap-2 mb-6">
            <input
              className="flex-1 border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white"
              placeholder="https://example.com/page"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button
              onClick={runAudit}
              disabled={loading || !url.trim()}
              className="px-4 py-2 rounded-lg bg-[#FF6B2C] text-white disabled:opacity-50"
            >
              {loading ? 'Scanning…' : 'Scan'}
            </button>
          </div>

          {error && <p className="text-red-600 mb-4">{error}</p>}

          {audit && (
            <div className="space-y-6">
              <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white">
                <div className="flex flex-wrap gap-4 items-baseline">
                  <div>
                    <div className="text-3xl font-semibold">{audit.score}</div>
                    <div className="text-xs text-[#9B9B9B]">Overall</div>
                  </div>
                  <div>
                    <div className="text-lg">{audit.siteType.siteType}</div>
                    <div className="text-xs text-[#9B9B9B]">
                      site type · {audit.siteType.confidence}
                      {audit.siteType.pageRole ? ` · ${audit.siteType.pageRole}` : ''}
                    </div>
                  </div>
                  <div className="text-sm text-[#6B6B6B]">
                    HTTP {audit.httpStatus} · {audit.signals.wordCount} words ·{' '}
                    {audit.signals.hasProductSchema ? 'Product schema' : audit.signals.hasSchema ? 'Schema present' : 'No schema'}
                  </div>
                </div>
                {audit.siteType.signals.length > 0 && (
                  <p className="text-xs text-[#9B9B9B] mt-2">Signals: {audit.siteType.signals.join(', ')}</p>
                )}
                {audit.crawlNotes.map((n) => (
                  <p key={n} className="text-xs text-amber-700 mt-1">{n}</p>
                ))}
              </div>

              <div>
                <h2 className="font-medium mb-2">Dimensions</h2>
                <div className="grid gap-2">
                  {audit.explainable.dimensions.map((d) => (
                    <div key={d.id} className="border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white flex justify-between gap-4">
                      <div>
                        <div className="font-medium">{d.label}</div>
                        <div className="text-xs text-[#6B6B6B]">{d.summary}</div>
                      </div>
                      <div className={`text-sm font-medium ${d.status === 'FAIL' ? 'text-red-600' : d.status === 'REVIEW' ? 'text-amber-600' : 'text-green-700'}`}>
                        {d.status}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[#9B9B9B] mt-2">{audit.explainable.scoreExplanation}</p>
                <p className="text-sm mt-1">Next: {audit.explainable.publishDecisionReason}</p>
              </div>

              <div>
                <h2 className="font-medium mb-2">Issues ({audit.issues.length})</h2>
                <ul className="space-y-2">
                  {audit.issues.slice(0, 40).map((issue) => (
                    <li key={issue.id} className="border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white">
                      <div className="text-xs uppercase tracking-wide text-[#9B9B9B]">
                        {issue.severity} · {issue.category}
                      </div>
                      <div className="font-medium">{issue.title}</div>
                      <div className="text-sm text-[#6B6B6B]">{issue.description}</div>
                      {issue.remediation && (
                        <div className="text-sm mt-1 text-[#0F0F0F]">What to do: {issue.remediation}</div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {audit.history.length > 0 && (
                <div>
                  <h2 className="font-medium mb-2">Score history</h2>
                  <ul className="text-sm text-[#6B6B6B] space-y-1">
                    {audit.history.map((h) => (
                      <li key={h.auditedAt}>
                        {new Date(h.auditedAt).toLocaleString()} — {h.score}
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

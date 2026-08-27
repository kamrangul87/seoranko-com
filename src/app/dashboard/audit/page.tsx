'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
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

interface ConnectionStatus {
  connected: boolean
  siteId?: string
  domain?: string
  brand?: string
  cmsType?: string
  lastVerifiedAt?: string | null
  prompt?: string
}

interface FixAttempt {
  id: string
  issueId?: string
  issue_id?: string
  issueTitle?: string
  issue_title?: string
  autoKind?: string
  auto_kind?: string
  strategy: string
  attemptNumber?: number
  attempt_number?: number
  status: string
  diffSummary?: string | null
  diff_summary?: string | null
  verificationDetail?: string | null
  verification_detail?: string | null
  errorMessage?: string | null
  error_message?: string | null
  revertible: boolean
  scoreBefore?: number | null
  score_before?: number | null
  scoreAfter?: number | null
  score_after?: number | null
}

interface HumanTask {
  kind: string
  title: string
  reason: string
  suggestedAction: string
  briefHint?: string
}

function classifyClientSide(issue: AuditIssue): 'auto' | 'human' | 'skip' {
  const hay = `${issue.id} ${issue.title} ${issue.description} ${issue.category}`
  if (/thin content|low word count|lacks indexable|placeholder product|ecom-description-thin|ecom-category-thin|ecom-description-placeholder/i.test(hay)) {
    return 'human'
  }
  if (/internal link|related-product linking|orphan|ecom-related-links/i.test(hay)) return 'human'
  if (/availability mismatch|pricing|stock claim|policy statement|ecom-availability-mismatch/i.test(hay)) {
    return 'human'
  }
  if (
    /title tag|meta title|meta description|missing h1|organization schema|article schema|product schema|breadcrumb|lang attribute|alt text|llms\.txt|html structure|x-frame|x-content-type|content-security-policy|security header|ecom-product|ecom-offer|ecom-image-alt|ecom-breadcrumb|ecom-category-missing-h1|ecom-title-templated/i.test(
      hay,
    )
  ) {
    return 'auto'
  }
  if (issue.severity === 'info') return 'skip'
  return 'human'
}

export default function AuditPage() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [audit, setAudit] = useState<AuditResult | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [fixRunning, setFixRunning] = useState(false)
  const [fixMessage, setFixMessage] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<FixAttempt[]>([])
  const [humanTasks, setHumanTasks] = useState<HumanTask[]>([])
  const [scoreAfterFix, setScoreAfterFix] = useState<number | null>(null)

  const refreshConnection = useCallback(async (auditUrl: string) => {
    try {
      const res = await fetch(`/api/copilot/site-connection?url=${encodeURIComponent(auditUrl)}`)
      if (!res.ok) {
        setConnection({ connected: false, prompt: 'Could not check site connection.' })
        return
      }
      const data = await res.json()
      setConnection(data)
    } catch {
      setConnection({ connected: false, prompt: 'Could not check site connection.' })
    }
  }, [])

  const refreshAttempts = useCallback(async (auditUrl: string) => {
    try {
      const res = await fetch(`/api/copilot/fix-agent?url=${encodeURIComponent(auditUrl)}`)
      if (!res.ok) return
      const data = await res.json()
      setAttempts(data.attempts || [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!audit?.url) return
    void refreshConnection(audit.url)
    void refreshAttempts(audit.url)
  }, [audit?.url, refreshConnection, refreshAttempts])

  async function runAudit() {
    setLoading(true)
    setError(null)
    setFixMessage(null)
    setHumanTasks([])
    setScoreAfterFix(null)
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

  async function runFixAgent() {
    if (!audit || !connection?.connected || !connection.siteId) return
    const ok = window.confirm(
      `Run Fix Agent on ${connection.domain} only?\n\nAuto-fixable structural issues will be applied via your ${connection.cmsType} connection. Thin content and linking issues become human tasks — never auto-published.\n\nYou can review and revert each change.`,
    )
    if (!ok) return

    setFixRunning(true)
    setFixMessage(null)
    try {
      const res = await fetch('/api/copilot/fix-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: audit.url,
          siteId: connection.siteId,
          issues: audit.issues,
          scoreBefore: audit.score,
          confirm: true,
        }),
      })
      const data = await res.json()
      if (!res.ok && !data.applied) {
        throw new Error(data.message || data.error || 'Fix Agent failed')
      }
      setFixMessage(data.message || 'Done')
      setHumanTasks(data.humanTasks || [])
      if (typeof data.scoreAfter === 'number') setScoreAfterFix(data.scoreAfter)
      if (Array.isArray(data.applied)) {
        setAttempts((prev) => [...data.applied, ...prev])
      }
      await refreshAttempts(audit.url)
    } catch (err) {
      setFixMessage(err instanceof Error ? err.message : 'Fix Agent failed')
    } finally {
      setFixRunning(false)
    }
  }

  async function revertAttempt(attemptId: string) {
    if (!attemptId) return
    setFixRunning(true)
    try {
      const res = await fetch('/api/copilot/fix-agent/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId }),
      })
      const data = await res.json()
      setFixMessage(data.message || (data.ok ? 'Reverted' : 'Revert failed'))
      if (audit?.url) await refreshAttempts(audit.url)
    } catch (err) {
      setFixMessage(err instanceof Error ? err.message : 'Revert failed')
    } finally {
      setFixRunning(false)
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
                  {scoreAfterFix != null && (
                    <div>
                      <div className="text-3xl font-semibold text-green-700">{scoreAfterFix}</div>
                      <div className="text-xs text-[#9B9B9B]">After Fix Agent</div>
                    </div>
                  )}
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

              {/* Connection gate — Fix Agent only when owned + connected */}
              <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white">
                <h2 className="font-medium mb-2">Site connection</h2>
                {connection?.connected ? (
                  <div className="space-y-3">
                    <p className="text-sm text-[#6B6B6B]">
                      Connected as <span className="text-[#0F0F0F] font-medium">{connection.domain}</span>
                      {connection.cmsType ? ` via ${connection.cmsType}` : ''}. Fix Agent can apply structural fixes only on this site.
                    </p>
                    <button
                      onClick={runFixAgent}
                      disabled={fixRunning}
                      className="px-4 py-2 rounded-lg bg-[#0F0F0F] text-white disabled:opacity-50"
                    >
                      {fixRunning ? 'Fix Agent running…' : 'Run Fix Agent'}
                    </button>
                    <p className="text-xs text-[#9B9B9B]">
                      One site per action. Every change is logged with before/after and can be reverted. Thin content and linking issues become human tasks.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-[#6B6B6B]">
                      {connection?.prompt ||
                        'This URL is not linked to an active site connection. You can view the audit report below — auto-fix is unavailable.'}
                    </p>
                    <Link href="/dashboard/settings" className="text-sm text-[#FF6B2C] underline">
                      Connect your site in Settings → Your Sites
                    </Link>
                  </div>
                )}
                {fixMessage && <p className="text-sm mt-3 text-[#0F0F0F]">{fixMessage}</p>}
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
                  {audit.issues.slice(0, 40).map((issue) => {
                    const fixability = classifyClientSide(issue)
                    return (
                      <li key={issue.id} className="border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white">
                        <div className="flex flex-wrap gap-2 items-center text-xs uppercase tracking-wide text-[#9B9B9B]">
                          <span>{issue.severity} · {issue.category}</span>
                          {fixability === 'auto' && (
                            <span className="normal-case tracking-normal text-green-800 bg-green-50 px-1.5 py-0.5 rounded">
                              Auto-fixable
                            </span>
                          )}
                          {fixability === 'human' && (
                            <span className="normal-case tracking-normal text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded">
                              Human / brief
                            </span>
                          )}
                        </div>
                        <div className="font-medium">{issue.title}</div>
                        <div className="text-sm text-[#6B6B6B]">{issue.description}</div>
                        {issue.remediation && (
                          <div className="text-sm mt-1 text-[#0F0F0F]">What to do: {issue.remediation}</div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>

              {humanTasks.length > 0 && (
                <div>
                  <h2 className="font-medium mb-2">Human tasks from Fix Agent</h2>
                  <ul className="space-y-2">
                    {humanTasks.map((t) => (
                      <li key={`${t.kind}-${t.title}`} className="border border-amber-200 rounded-lg px-3 py-2 bg-amber-50">
                        <div className="text-xs uppercase text-amber-800">{t.kind}</div>
                        <div className="font-medium">{t.title}</div>
                        <div className="text-sm text-[#6B6B6B]">{t.reason}</div>
                        <div className="text-sm mt-1">{t.suggestedAction}</div>
                        {t.kind === 'thin-content' && (
                          <Link href="/dashboard/briefs" className="text-sm text-[#FF6B2C] underline mt-1 inline-block">
                            Open Keyword Briefs
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {attempts.length > 0 && (
                <div>
                  <h2 className="font-medium mb-2">Fix Agent log</h2>
                  <ul className="space-y-2">
                    {attempts.slice(0, 30).map((a) => {
                      const id = a.id
                      const title = a.issueTitle || a.issue_title || a.issueId || a.issue_id
                      const summary = a.diffSummary || a.diff_summary
                      const detail = a.verificationDetail || a.verification_detail || a.errorMessage || a.error_message
                      return (
                        <li key={`${id}-${a.strategy}-${a.attemptNumber || a.attempt_number}`} className="border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white text-sm">
                          <div className="flex justify-between gap-2">
                            <div>
                              <span className="font-medium">{title}</span>
                              <span className="text-[#9B9B9B]"> · {a.autoKind || a.auto_kind} · {a.strategy} · {a.status}</span>
                            </div>
                            {a.revertible && !a.status.includes('revert') && (
                              <button
                                type="button"
                                disabled={fixRunning}
                                onClick={() => revertAttempt(id)}
                                className="text-xs underline text-[#6B6B6B] shrink-0"
                              >
                                Revert
                              </button>
                            )}
                          </div>
                          {summary && <div className="text-[#6B6B6B] mt-1">{summary}</div>}
                          {detail && <div className="text-xs text-[#9B9B9B] mt-0.5">{detail}</div>}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

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

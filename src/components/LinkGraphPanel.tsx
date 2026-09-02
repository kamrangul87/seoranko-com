'use client'

import { useState } from 'react'
import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'

interface LinkFindingRow {
  ruleId?: string
  rule_id?: string
  severity: string
  sourceUrl?: string | null
  source_url?: string | null
  targetUrl?: string | null
  target_url?: string | null
  suggestedTarget?: string | null
  suggested_target?: string | null
  evidence?: Record<string, unknown>
}

interface LinkGraphSummary {
  verdictHeadline: string
  topCauses: Array<{
    ruleId: string
    title: string
    affectedCount: number
    whyItMatters: string
    whatToChange: string
  }>
  findingCount: number
  criticalCount: number
  failCount: number
  warnCount: number
  jsSuspected?: boolean
  trailingSlashConvention?: boolean
}

/**
 * Link Graph Audit panel — verdict-first report over Index Diagnosis crawl.
 * Copy constraints: crawl-budget / contradictory signals — never "Google link policy".
 */
export function LinkGraphPanel({
  diagnosis,
  domain,
}: {
  diagnosis: IndexDiagnosisResult
  domain?: string
}) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<LinkGraphSummary | null>(null)
  const [findings, setFindings] = useState<LinkFindingRow[]>([])
  const [auditId, setAuditId] = useState<string | null>(null)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  async function run() {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/audit/new/links/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: domain || diagnosis.coverage.domain,
          diagnosis,
          resolveExternal: false,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Link graph failed')
      setAuditId(json.auditId)
      setSummary(json.summary)
      setFindings(json.topFindings || json.findings || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link graph failed')
    } finally {
      setRunning(false)
    }
  }

  const byRule = new Map<string, LinkFindingRow[]>()
  for (const f of findings) {
    const id = f.ruleId || f.rule_id || 'unknown'
    const list = byRule.get(id) || []
    list.push(f)
    byRule.set(id, list)
  }

  return (
    <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium text-[#0F0F0F]">Link Graph</h2>
          <p className="text-xs text-[#6B6B6B] mt-0.5">
            Finds broken, redirected, and non-canonical internal links — and pages Google can&apos;t
            reach through your own links. Uses the Index Diagnosis crawl (no second paid API).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="text-sm px-3 py-1.5 rounded-lg bg-[#0F0F0F] text-white disabled:opacity-50"
        >
          {running ? 'Analysing links…' : summary ? 'Re-run Link Graph' : 'Run Link Graph'}
        </button>
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}

      {summary && (
        <div className="space-y-3">
          <p className="text-sm text-[#0F0F0F] font-medium">{summary.verdictHeadline}</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-red-50 text-red-800">
              {summary.criticalCount} critical
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800">
              {summary.failCount} fail
            </span>
            <span className="px-2 py-0.5 rounded bg-[#FAFAFA] text-[#6B6B6B]">
              {summary.warnCount} warn
            </span>
            <span className="px-2 py-0.5 rounded bg-[#FAFAFA] text-[#6B6B6B]">
              {summary.findingCount} total
            </span>
          </div>

          {summary.jsSuspected && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              JavaScript-rendered links suspected — link coverage on this site may be incomplete.
              Structural orphan findings are suppressed for this run.
            </p>
          )}

          {summary.topCauses.length > 0 && (
            <div>
              <div className="text-xs font-medium text-[#9B9B9B] uppercase mb-1">Top causes</div>
              <ul className="space-y-2">
                {summary.topCauses.map((c) => (
                  <li key={c.ruleId} className="text-sm border border-[#E5E5E5] rounded-lg p-2">
                    <div className="font-medium">
                      {c.title}{' '}
                      <span className="text-[#9B9B9B] font-normal">({c.affectedCount})</span>
                    </div>
                    <div className="text-xs text-[#6B6B6B] mt-0.5">{c.whyItMatters}</div>
                    <div className="text-xs text-[#0F0F0F] mt-1">What to change: {c.whatToChange}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="text-xs font-medium text-[#9B9B9B] uppercase mb-1">Findings</div>
            <ul className="space-y-1">
              {Array.from(byRule.entries()).map(([ruleId, rows]) => {
                const open = openGroups[ruleId] ?? ruleId.startsWith('L0')
                return (
                  <li key={ruleId} className="border border-[#E5E5E5] rounded-lg">
                    <button
                      type="button"
                      className="w-full text-left px-2 py-1.5 text-sm flex justify-between gap-2"
                      onClick={() => setOpenGroups((p) => ({ ...p, [ruleId]: !open }))}
                    >
                      <span>
                        <span className="font-mono text-xs text-[#9B9B9B]">{ruleId}</span>{' '}
                        {rows[0]?.severity} · {rows.length}
                      </span>
                      <span className="text-[#9B9B9B]">{open ? '▾' : '▸'}</span>
                    </button>
                    {open && (
                      <ul className="px-2 pb-2 space-y-1 text-xs font-mono text-[#6B6B6B] max-h-40 overflow-y-auto">
                        {rows.slice(0, 40).map((r, i) => (
                          <li key={i} className="break-all">
                            {(r.sourceUrl || r.source_url) && (
                              <span>{r.sourceUrl || r.source_url} → </span>
                            )}
                            {r.targetUrl || r.target_url || '—'}
                            {(r.suggestedTarget || r.suggested_target) && (
                              <span className="text-green-800">
                                {' '}
                                (suggest: {r.suggestedTarget || r.suggested_target})
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>

          {auditId && (
            <div className="flex flex-wrap gap-2">
              <a
                href={`/api/audit/${auditId}/links/export?format=csv`}
                className="text-xs px-3 py-1.5 rounded-lg border border-[#E5E5E5] bg-white hover:bg-[#FAFAFA]"
              >
                Download fix list (CSV)
              </a>
              <a
                href={`/api/audit/${auditId}/links/export?format=json`}
                className="text-xs px-3 py-1.5 rounded-lg border border-[#E5E5E5] bg-white hover:bg-[#FAFAFA]"
              >
                Download fix list (JSON)
              </a>
            </div>
          )}

          <p className="text-[11px] text-[#9B9B9B]">
            Trailing-slash convention detected:{' '}
            {summary.trailingSlashConvention ? 'with trailing slash' : 'without trailing slash'}.
          </p>
        </div>
      )}
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'
import type { PageAuditIssue } from '@/lib/page-audit-engine'
import type { LinkFinding, LinkGraphResult } from '@/lib/link-graph/types'
import {
  LINK_REDIRECT_HOP_RULES,
  buildLinkGraphFixAgentIssues,
  buildRedirectHopBulkIssue,
  buildSingleHrefRewriteIssue,
} from '@/lib/link-graph/fix-agent-issues'
import { applyPasteAndFix } from '@/lib/manual-paste-fix'

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

function toFinding(row: LinkFindingRow): LinkFinding {
  return {
    ruleId: row.ruleId || row.rule_id || 'unknown',
    severity: (row.severity as LinkFinding['severity']) || 'WARN',
    sourceUrl: row.sourceUrl ?? row.source_url ?? null,
    targetUrl: row.targetUrl ?? row.target_url ?? null,
    suggestedTarget: row.suggestedTarget ?? row.suggested_target ?? null,
    evidence: row.evidence || {},
  }
}

function toResult(findings: LinkFindingRow[]): LinkGraphResult {
  const normalized = findings.map(toFinding)
  return {
    edges: [],
    targets: [],
    findings: normalized,
    rankedFindings: normalized,
    trailingSlashConvention: false,
    jsSuspected: false,
    jsSuspectedUrls: [],
    verdictHeadline: '',
    topCauses: [],
    ranAt: new Date().toISOString(),
  }
}

function ManualHrefPaste({
  sourceUrl,
  fromHref,
  toHref,
}: {
  sourceUrl: string
  fromHref: string
  toHref: string
}) {
  const [open, setOpen] = useState(false)
  const [html, setHtml] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  function run() {
    setError(null)
    setSummary(null)
    const result = applyPasteAndFix({
      html,
      fixKind: 'link_href',
      hrefFixes: [{ fromHref, toHref }],
    })
    if (!result.ok) {
      setOutput(null)
      setError(result.error || 'Could not apply href fix.')
      return
    }
    setOutput(result.html)
    setSummary(result.summary)
  }

  return (
    <div className="mt-1 font-sans">
      <button
        type="button"
        className="text-[11px] text-green-800 underline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide manual fix' : 'Manual fix (paste HTML)'}
      </button>
      {open && (
        <div className="mt-1 border border-green-200 rounded-lg p-2 bg-green-50 space-y-2">
          <p className="text-[11px] text-[#6B6B6B]">
            Paste HTML for <span className="font-mono break-all">{sourceUrl}</span>. Only the
            flagged href is rewritten ({fromHref} → {toHref}).
          </p>
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={5}
            placeholder="Paste source page HTML here…"
            className="w-full text-[11px] font-mono border border-[#E5E5E5] rounded-lg p-2 bg-white"
          />
          <button
            type="button"
            onClick={run}
            disabled={!html.trim()}
            className="text-[11px] px-2 py-1 rounded-lg bg-green-800 text-white disabled:opacity-50"
          >
            Apply href fix
          </button>
          {error && <p className="text-[11px] text-red-700">{error}</p>}
          {summary && <p className="text-[11px] text-green-800">{summary}</p>}
          {output && (
            <pre className="text-[11px] font-mono p-2 bg-white border rounded-lg max-h-48 overflow-auto whitespace-pre-wrap break-all">
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Link Graph Audit panel — verdict-first report over Index Diagnosis crawl.
 * Copy constraints: crawl-budget / contradictory signals — never "Google link policy".
 */
export function LinkGraphPanel({
  diagnosis,
  domain,
  siteId,
  cmsConnected,
  auditUrl,
  fixRunning,
  onRunFixAgent,
}: {
  diagnosis: IndexDiagnosisResult
  domain?: string
  siteId?: string
  cmsConnected?: boolean
  auditUrl?: string
  fixRunning?: boolean
  onRunFixAgent?: (issues: PageAuditIssue[]) => void
}) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<LinkGraphSummary | null>(null)
  const [findings, setFindings] = useState<LinkFindingRow[]>([])
  const [auditId, setAuditId] = useState<string | null>(null)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [diffPreview, setDiffPreview] = useState<string | null>(null)

  const result = useMemo(() => toResult(findings), [findings])
  const allFixIssues = useMemo(() => buildLinkGraphFixAgentIssues(result), [result])
  const redirectBulk = useMemo(() => buildRedirectHopBulkIssue(result), [result])
  const nonCanonicalBulk = useMemo(
    () => allFixIssues.find((i) => i.id === 'link-bulk-non-canonical') || null,
    [allFixIssues],
  )
  const redirectCount = useMemo(
    () => findings.filter((f) => LINK_REDIRECT_HOP_RULES.has(f.ruleId || f.rule_id || '')).length,
    [findings],
  )

  async function run() {
    setRunning(true)
    setError(null)
    setDiffPreview(null)
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

  function previewBulkDiff() {
    const fixes = redirectBulk?.fixMetadata?.hrefFixes || []
    if (fixes.length === 0) {
      setDiffPreview(null)
      return
    }
    setDiffPreview(
      `Before → after (${fixes.length} href rewrite(s)):\n\n` +
        fixes.map((f) => `${f.sourceUrl}\n  ${f.fromHref}  →  ${f.toHref}`).join('\n\n'),
    )
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

          {redirectCount > 0 && (
            <div className="border border-[#E5E5E5] rounded-lg p-3 bg-[#FAFAFA] space-y-2">
              <div className="text-sm font-medium text-[#0F0F0F]">
                Fix all redirect-hop links ({redirectCount})
              </div>
              <p className="text-xs text-[#6B6B6B]">
                Updates each source page&apos;s &lt;a href&gt; to the suggested final URL in one
                action. Preview the before/after list first — Fix Agent keeps a full revert snapshot.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={previewBulkDiff}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[#E5E5E5] bg-white"
                >
                  Preview before/after
                </button>
                {cmsConnected && siteId && onRunFixAgent && redirectBulk ? (
                  <button
                    type="button"
                    onClick={() => {
                      previewBulkDiff()
                      onRunFixAgent([redirectBulk])
                    }}
                    disabled={!!fixRunning}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[#0F0F0F] text-white disabled:opacity-50"
                  >
                    {fixRunning ? 'Applying…' : 'Fix all redirect-hop links'}
                  </button>
                ) : (
                  <p className="text-xs text-[#6B6B6B] self-center">
                    Connect GitHub (or another CMS) to auto-apply, or use Manual fix on a finding.
                  </p>
                )}
                {cmsConnected && onRunFixAgent && nonCanonicalBulk && (
                  <button
                    type="button"
                    onClick={() => onRunFixAgent([nonCanonicalBulk])}
                    disabled={!!fixRunning}
                    className="text-xs px-3 py-1.5 rounded-lg border border-[#E5E5E5] bg-white disabled:opacity-50"
                  >
                    Fix all non-canonical targets
                  </button>
                )}
              </div>
              {diffPreview && (
                <pre className="text-[11px] font-mono p-2 bg-white border rounded-lg max-h-56 overflow-auto whitespace-pre-wrap break-all">
                  {diffPreview}
                </pre>
              )}
            </div>
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
                      <ul className="px-2 pb-2 space-y-2 text-xs font-mono text-[#6B6B6B] max-h-64 overflow-y-auto">
                        {rows.slice(0, 40).map((r, i) => {
                          const finding = toFinding(r)
                          const single = buildSingleHrefRewriteIssue(finding)
                          const fromHref =
                            typeof finding.evidence.hrefRaw === 'string'
                              ? finding.evidence.hrefRaw
                              : finding.targetUrl || ''
                          return (
                            <li
                              key={i}
                              className="break-all border-t border-[#F0F0F0] pt-1 first:border-0 first:pt-0"
                            >
                              {finding.sourceUrl && <span>{finding.sourceUrl} → </span>}
                              {finding.targetUrl || '—'}
                              {finding.suggestedTarget && (
                                <span className="text-green-800">
                                  {' '}
                                  (suggest: {finding.suggestedTarget})
                                </span>
                              )}
                              <div className="flex flex-wrap gap-2 mt-1 font-sans">
                                {cmsConnected && onRunFixAgent && single && (
                                  <button
                                    type="button"
                                    disabled={!!fixRunning}
                                    className="text-[11px] px-2 py-0.5 rounded border border-[#E5E5E5] bg-white disabled:opacity-50"
                                    onClick={() => onRunFixAgent([single])}
                                  >
                                    Auto-fix
                                  </button>
                                )}
                              </div>
                              {single && finding.sourceUrl && finding.suggestedTarget && fromHref && (
                                <ManualHrefPaste
                                  sourceUrl={finding.sourceUrl}
                                  fromHref={fromHref}
                                  toHref={finding.suggestedTarget}
                                />
                              )}
                              {ruleId === 'L01' && (
                                <p className="text-[11px] font-sans text-[#6B6B6B] mt-1">
                                  Dead link — Fix Agent can remove the &lt;a&gt; from the source page
                                  (same path as Index Diagnosis). Destination content is never
                                  invented.
                                </p>
                              )}
                            </li>
                          )
                        })}
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
            {auditUrl ? ` · Audit URL: ${auditUrl}` : ''}
          </p>
        </div>
      )}
    </div>
  )
}

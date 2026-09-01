'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'
import { lookupManualFixForUrl } from '@/lib/index-diagnosis/manual-fixes'
import { ManualFixPanel } from '@/components/ManualFixPanel'

const EXCLUDE_LABELS: Record<string, string> = {
  ROBOTS_DISALLOWED: 'Robots.txt disallowed',
  META_NOINDEX: 'Meta noindex',
  X_ROBOTS_NOINDEX: 'X-Robots noindex',
  NON_200: 'Non-200 HTTP',
  DEPTH_LIMIT: 'Depth limit',
  TIMEOUT: 'Timeout',
  PLAN_LIMIT: 'Plan limit',
  REDIRECT_CHAIN: 'Redirect chain',
  NOT_REACHED: 'Not reached',
}

function verdictColor(v: string): string {
  if (v === 'INDEXABLE') return 'text-green-800 bg-green-50'
  if (v === 'BLOCKED') return 'text-red-800 bg-red-50'
  return 'text-amber-800 bg-amber-50'
}

function ExcludedByReasonList({
  coverage,
}: {
  coverage: IndexDiagnosisResult['coverage']
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ NON_200: true })
  const excludedReasons = Object.entries(coverage.excludedByReason).filter(([, n]) => n > 0)

  if (excludedReasons.length === 0) return null

  return (
    <div className="mb-3">
      <div className="text-xs font-medium text-[#9B9B9B] uppercase mb-1">Excluded by reason</div>
      <ul className="text-sm space-y-2">
        {excludedReasons.map(([reason, count]) => {
          const items = coverage.excluded.filter((e) => e.reason === reason)
          const isOpen = expanded[reason] ?? false
          return (
            <li key={reason}>
              <button
                type="button"
                onClick={() => setExpanded((prev) => ({ ...prev, [reason]: !isOpen }))}
                className="text-left w-full flex items-center gap-2 hover:text-[#0F0F0F]"
              >
                <span className="text-[#9B9B9B] w-4 shrink-0">{isOpen ? '▾' : '▸'}</span>
                <span>
                  {EXCLUDE_LABELS[reason] || reason}: <span className="font-medium">{count}</span>
                </span>
              </button>
              {isOpen && (
                <ul className="mt-1 ml-6 space-y-1 text-xs font-mono text-[#6B6B6B] max-h-48 overflow-y-auto">
                  {items.map((e) => (
                    <li key={`${e.url}-${e.evidence}`} className="break-all">
                      <a href={e.url} className="text-[#FF6B2C] underline" target="_blank" rel="noreferrer">
                        {e.url}
                      </a>
                      {e.httpStatus != null && (
                        <span className="text-red-700 font-semibold"> — HTTP {e.httpStatus}</span>
                      )}
                      {!e.httpStatus && <span> — {e.evidence}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function IndexDiagnosisPanel({
  data,
  siteId,
}: {
  data: IndexDiagnosisResult
  siteId?: string
}) {
  const { coverage, verdict, pages, cohorts, followUpTasks, manualFixesByTaskId } = data
  const topCauses = verdict.topCauses
  const [expandedFix, setExpandedFix] = useState<Record<string, boolean>>({})
  const [urlLookup, setUrlLookup] = useState('')
  const [lookupFix, setLookupFix] = useState<ReturnType<typeof lookupManualFixForUrl>>(null)
  const [lookupMessage, setLookupMessage] = useState<string | null>(null)

  function toggleFix(taskId: string) {
    setExpandedFix((prev) => ({ ...prev, [taskId]: !prev[taskId] }))
  }

  function runUrlLookup() {
    const trimmed = urlLookup.trim()
    if (!trimmed) return
    const inboundMap = new Map(
      Object.entries(data.inboundLinksByUrl || {}).map(([k, v]) => [k, v]),
    )
    const fix = lookupManualFixForUrl(trimmed, data, inboundMap)
    setLookupFix(fix)
    setLookupMessage(fix ? null : 'No manual fix found for this URL in the current crawl.')
  }

  return (
    <div className="space-y-4">
      <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white">
        <h2 className="font-medium mb-2">Index Diagnosis</h2>
        <p className="text-sm text-[#0F0F0F] leading-relaxed">{verdict.headline}</p>
        {topCauses.length > 0 && (
          <ol className="mt-3 space-y-2 list-decimal list-inside text-sm">
            {topCauses.map((c) => (
              <li key={c.cause}>
                <span className="font-medium">{c.cause}</span>
                {' — '}
                {c.affectedUrlCount} URL{c.affectedUrlCount !== 1 ? 's' : ''}. Example:{' '}
                <a href={c.exampleUrl} className="text-[#FF6B2C] underline break-all" target="_blank" rel="noreferrer">
                  {c.exampleUrl}
                </a>
                <div className="text-xs text-[#6B6B6B] ml-5 mt-0.5 font-mono">{c.exampleEvidence}</div>
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap gap-3 mt-3 text-xs text-[#6B6B6B]">
          <span>{verdict.indexableCount} indexable</span>
          <span>{verdict.blockedCount} blocked</span>
          <span>{verdict.atRiskCount} at risk</span>
          <span>· {coverage.fetchedCount} pages crawled</span>
        </div>
      </div>

      <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white">
        <h2 className="font-medium mb-2">Crawl coverage</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
          <div>
            <div className="text-2xl font-semibold">{coverage.discoveredCount}</div>
            <div className="text-xs text-[#9B9B9B]">URLs discovered</div>
          </div>
          <div>
            <div className="text-2xl font-semibold">{coverage.fetchedCount}</div>
            <div className="text-xs text-[#9B9B9B]">URLs fetched</div>
          </div>
          <div>
            <div className="text-2xl font-semibold">{coverage.excluded.length}</div>
            <div className="text-xs text-[#9B9B9B]">URLs excluded</div>
          </div>
          <div>
            <div className="text-xs text-[#9B9B9B]">Crawl stopped</div>
            <div className="text-sm font-medium">{coverage.terminationReason.replace(/_/g, ' ').toLowerCase()}</div>
          </div>
        </div>
        <p className="text-xs text-[#6B6B6B] mb-2">{coverage.terminationEvidence}</p>
        <p className="text-xs text-[#6B6B6B] mb-2">{coverage.robotsTxtEvidence}</p>
        <ExcludedByReasonList coverage={coverage} />
        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          {coverage.sitemapOnlyUrls.length > 0 && (
            <div>
              <div className="font-medium mb-1">In sitemap, not linked internally ({coverage.sitemapOnlyUrls.length})</div>
              <ul className="text-[#6B6B6B] max-h-32 overflow-y-auto space-y-0.5">
                {coverage.sitemapOnlyUrls.map((u) => (
                  <li key={u} className="break-all">{u}</li>
                ))}
              </ul>
            </div>
          )}
          {coverage.linkedOnlyUrls.length > 0 && (
            <div>
              <div className="font-medium mb-1 flex flex-wrap items-center gap-2">
                Linked, absent from sitemap ({coverage.linkedOnlyUrls.length})
                <Link
                  href={`/dashboard/sitemap?domain=${encodeURIComponent(coverage.domain)}`}
                  className="text-[#FF6B2C] underline font-normal"
                >
                  Open Sitemap Generator
                </Link>
              </div>
              <ul className="text-[#6B6B6B] max-h-32 overflow-y-auto space-y-0.5">
                {coverage.linkedOnlyUrls.map((u) => (
                  <li key={u} className="break-all">{u}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {followUpTasks.length > 0 && (
        <div className="border border-blue-200 rounded-xl p-4 bg-blue-50">
          <h2 className="font-medium mb-2">Recommended site fixes</h2>
          <p className="text-xs text-[#6B6B6B] mb-3">
            Mechanical follow-ups from this crawl — apply on your live site (not auto-fixed by SEORANKO).
          </p>

          <div className="mb-4 p-3 rounded-lg bg-white border border-blue-100">
            <div className="text-xs font-medium text-[#0F0F0F] mb-1">Manual fix lookup</div>
            <p className="text-xs text-[#6B6B6B] mb-2">Paste any URL from this crawl to get step-by-step or paste-and-fix guidance.</p>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={urlLookup}
                onChange={(e) => setUrlLookup(e.target.value)}
                placeholder="https://example.com/page or /path"
                className="flex-1 min-w-[200px] text-sm border border-[#E5E5E5] rounded-lg px-2 py-1.5"
              />
              <button
                type="button"
                onClick={runUrlLookup}
                className="text-sm px-3 py-1.5 rounded-lg bg-[#0F0F0F] text-white"
              >
                Get manual fix
              </button>
            </div>
            {lookupMessage && <p className="text-xs text-[#6B6B6B] mt-2">{lookupMessage}</p>}
            {lookupFix && <ManualFixPanel fix={lookupFix} siteId={siteId} />}
          </div>

          <ul className="space-y-3 text-sm">
            {followUpTasks.map((t) => {
              const fix = manualFixesByTaskId?.[t.id]
              const isOpen = expandedFix[t.id] ?? false
              const isSitemapGap = t.kind === 'sitemap_gap' || t.id === 'sitemap-missing-linked-urls'
              return (
                <li key={t.id} className="border border-blue-100 rounded-lg px-3 py-2 bg-white">
                  <div className="font-medium">{t.title}</div>
                  <div className="text-[#6B6B6B] mt-0.5">{t.detail}</div>
                  <div className="text-xs font-mono text-[#9B9B9B] mt-1">{t.evidence}</div>
                  {isSitemapGap && (
                    <Link
                      href={`/dashboard/sitemap?domain=${encodeURIComponent(coverage.domain)}`}
                      className="inline-block mt-2 text-xs px-3 py-1.5 rounded-lg bg-[#FF6B2C] text-white"
                    >
                      Open Sitemap Generator
                    </Link>
                  )}
                  {t.affectedUrls.length > 0 && (
                    <ul className="mt-2 text-xs space-y-0.5">
                      {t.affectedUrls.map((u) => (
                        <li key={u} className="break-all">
                          <a href={u} className="text-[#FF6B2C] underline" target="_blank" rel="noreferrer">
                            {u}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  {fix && !isSitemapGap && (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleFix(t.id)}
                        className="mt-2 text-xs text-[#FF6B2C] underline"
                      >
                        {isOpen ? 'Hide manual fix' : 'Get manual fix'}
                      </button>
                      {isOpen && <ManualFixPanel fix={fix} siteId={siteId} />}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {cohorts.filter((c) => c.flagged).length > 0 && (
        <div className="border border-amber-200 rounded-xl p-4 bg-amber-50">
          <h2 className="font-medium mb-2">Flagged cohorts</h2>
          <ul className="space-y-2 text-sm">
            {cohorts
              .filter((c) => c.flagged)
              .slice(0, 8)
              .map((c) => (
                <li key={c.cohortId}>
                  <div className="font-medium">{c.label}</div>
                  <div className="text-xs text-[#6B6B6B]">
                    {c.size} URLs · median depth {c.medianDepth} · median links in {c.medianInternalLinksIn} ·{' '}
                    {(c.duplicateClusterDensity * 100).toFixed(0)}% near-duplicate ·{' '}
                    {(c.atRiskShare * 100).toFixed(0)}% AT_RISK
                  </div>
                  {c.flagEvidence && <div className="text-xs font-mono mt-0.5">{c.flagEvidence}</div>}
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white">
        <h2 className="font-medium mb-2">Per-URL indexability ({pages.length} crawled)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[#9B9B9B] border-b">
                <th className="py-1 pr-2">URL</th>
                <th className="py-1 pr-2">Verdict</th>
                <th className="py-1 pr-2">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.url} className="border-b border-[#F0F0F0] align-top">
                  <td className="py-1.5 pr-2 max-w-[180px] break-all">
                    <a href={p.url} className="text-[#FF6B2C] underline" target="_blank" rel="noreferrer">
                      {p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                    </a>
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    <span className={`px-1.5 py-0.5 rounded ${verdictColor(p.verdict)}`}>{p.verdict}</span>
                  </td>
                  <td className="py-1.5 text-[#6B6B6B] font-mono break-all">{p.decisiveEvidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

'use client'

import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'

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

export function IndexDiagnosisPanel({ data }: { data: IndexDiagnosisResult }) {
  const { coverage, verdict, topCauses, pages, cohorts } = data
  const excludedReasons = Object.entries(coverage.excludedByReason).filter(([, n]) => n > 0)

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

        {excludedReasons.length > 0 && (
          <div className="mb-3">
            <div className="text-xs font-medium text-[#9B9B9B] uppercase mb-1">Excluded by reason</div>
            <ul className="text-sm space-y-1">
              {excludedReasons.map(([reason, count]) => (
                <li key={reason}>
                  {EXCLUDE_LABELS[reason] || reason}: <span className="font-medium">{count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          {coverage.sitemapOnlyUrls.length > 0 && (
            <div>
              <div className="font-medium mb-1">In sitemap, not linked internally ({coverage.sitemapOnlyUrls.length})</div>
              <ul className="text-[#6B6B6B] max-h-24 overflow-y-auto">
                {coverage.sitemapOnlyUrls.slice(0, 8).map((u) => (
                  <li key={u} className="truncate">{u}</li>
                ))}
              </ul>
            </div>
          )}
          {coverage.linkedOnlyUrls.length > 0 && (
            <div>
              <div className="font-medium mb-1">Linked, absent from sitemap ({coverage.linkedOnlyUrls.length})</div>
              <ul className="text-[#6B6B6B] max-h-24 overflow-y-auto">
                {coverage.linkedOnlyUrls.slice(0, 8).map((u) => (
                  <li key={u} className="truncate">{u}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

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
              {pages.slice(0, 30).map((p) => (
                <tr key={p.url} className="border-b border-[#F0F0F0] align-top">
                  <td className="py-1.5 pr-2 max-w-[140px] truncate">
                    <a href={p.url} className="text-[#FF6B2C] underline" target="_blank" rel="noreferrer">
                      {p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                    </a>
                  </td>
                  <td className="py-1.5 pr-2">
                    <span className={`px-1.5 py-0.5 rounded ${verdictColor(p.verdict)}`}>{p.verdict}</span>
                  </td>
                  <td className="py-1.5 text-[#6B6B6B] font-mono">{p.decisiveEvidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages.length > 30 && (
          <p className="text-xs text-[#9B9B9B] mt-2">Showing 30 of {pages.length} URLs.</p>
        )}
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { DashboardNav } from '@/components/DashboardNav'
import type { FindingsListResponse, UiFinding } from '@/lib/fix-strategies/findings-ui/client'

function severityTone(severity: string | null): string {
  if (severity === 'high' || severity === 'critical') return 'text-red-700 bg-red-50 border-red-100'
  if (severity === 'moderate') return 'text-amber-800 bg-amber-50 border-amber-100'
  if (severity === 'low') return 'text-[#6B6B6B] bg-[#F4F4F2] border-[#E8E8E4]'
  if (severity === 'informational') return 'text-[#6B6B6B] bg-[#F4F4F2] border-[#E8E8E4]'
  return 'text-[#6B6B6B] bg-white border-[#E8E8E4]'
}

function surfaceLabel(f: UiFinding): string {
  switch (f.surfaceClass) {
    case 'auto-fixable':
      return 'Auto-fixable'
    case 'human-review':
      return 'Human review'
    case 'informational':
      return 'Informational'
    case 'report-only':
      return 'Report only'
    case 'finding':
      return 'Finding'
    default:
      return f.surfaceClass
  }
}

export default function FindingsListPage() {
  const [includeInformational, setIncludeInformational] = useState(false)
  const [data, setData] = useState<FindingsListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (informational: boolean) => {
    setLoading(true)
    setError(null)
    try {
      const q = informational ? '?informational=1' : ''
      const res = await fetch(`/api/fix-strategies/findings${q}`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setData((await res.json()) as FindingsListResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load findings')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(includeInformational)
  }, [includeInformational, load])

  return (
    <div
      className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden"
      style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}
    >
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <div className="mb-6">
            <p className="text-xs uppercase tracking-wide text-[#9B9B9B] mb-1">
              Fix strategies
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Findings</h1>
            <p className="text-[#6B6B6B] mt-1">
              Actionable findings from the register. Suppressed, ok, and routed
              evidence stays internal.
            </p>
          </div>

          {data && (
            <div className="flex flex-wrap items-center gap-3 mb-6 text-sm text-[#6B6B6B]">
              <span className="px-2.5 py-1 rounded-md bg-white border border-[#E8E8E4]">
                {data.counts.actionable} actionable
              </span>
              <span className="px-2.5 py-1 rounded-md bg-white border border-[#E8E8E4]">
                {data.counts.informational} informational
              </span>
              <span
                className="px-2.5 py-1 rounded-md bg-[#F4F4F2] border border-[#E8E8E4] text-[#9B9B9B]"
                title="Internal audit trail — not shown in this list"
              >
                {data.counts.internal} internal (hidden)
              </span>
              {data.demo && (
                <span className="px-2.5 py-1 rounded-md border border-dashed border-[#E8E8E4] text-[#9B9B9B]">
                  Demo · {data.origin}
                </span>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 mb-6 text-sm text-[#6B6B6B] cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-[#E8E8E4] text-[#FF6B2C] focus:ring-[#FF6B2C]"
              checked={includeInformational}
              onChange={(e) => setIncludeInformational(e.target.checked)}
            />
            Show informational
          </label>

          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-20 rounded-[10px] bg-white border border-[#E8E8E4] animate-pulse"
                />
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-[10px] border border-red-100 bg-red-50 text-red-800 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {!loading && !error && data && data.findings.length === 0 && (
            <div className="rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-8 text-center text-[#6B6B6B]">
              No findings in this view.
            </div>
          )}

          {!loading && data && data.findings.length > 0 && (
            <ul className="space-y-3">
              {data.findings.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/dashboard/findings/${f.id}`}
                    className="block rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-4 hover:border-[#FF6B2C]/40 transition-colors"
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded border ${severityTone(f.severity)}`}
                      >
                        {f.severity ?? '—'}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded border border-[#E8E8E4] text-[#6B6B6B]">
                        {surfaceLabel(f)}
                      </span>
                      <span className="text-xs text-[#9B9B9B]">
                        Topic {f.topicId}
                      </span>
                    </div>
                    <p className="font-medium text-[#0F0F0F] leading-snug">
                      {f.verdict}
                    </p>
                    {f.rolledUp && f.declarationSite ? (
                      <p className="text-sm text-[#6B6B6B] mt-1">
                        Component{' '}
                        <span className="font-mono text-[#0F0F0F]">
                          {f.declarationSite}
                        </span>
                        {' · '}
                        {f.affectedUrlCount} URLs affected
                      </p>
                    ) : (
                      f.pageUrl && (
                        <p className="text-sm text-[#6B6B6B] mt-1 truncate">
                          {f.pageUrl}
                        </p>
                      )
                    )}
                    <p className="text-sm text-[#6B6B6B] mt-2 line-clamp-2">
                      {f.detail}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  )
}

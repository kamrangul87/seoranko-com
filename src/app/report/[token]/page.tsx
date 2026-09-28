'use client'
import { useEffect, useState } from 'react'

type UiFinding = {
  pageUrl: string | null
  ownerPlainEnglish: string
  whyNotAutoFixed: string | null
  sourceTier: string
  primarySourceId: number | null
  sources: { sourceId: number; url: string | null; verifiedOn: string | null }[]
}

type LedgerEntry = {
  prUrl: string | null
  prNumber: number | null
  mergeSha: string | null
  productionVerifyOk: boolean | null
  productionVerifyAt: string | null
  fixedAt: string | null
}

type ReportFinding = { finding: UiFinding; ledger: LedgerEntry | null }
type FixAppliedEntry = { page: string | null; plainEnglish: string; ledger: LedgerEntry }

type ShareableReport = {
  origin: string
  from: string | null
  to: string | null
  generatedAt: string
  detected: ReportFinding[]
  fixesApplied: FixAppliedEntry[]
  resolved: ReportFinding[]
  regressed: ReportFinding[]
  notFixed: ReportFinding[]
}

function sourceLine(f: UiFinding): string {
  const row =
    (f.primarySourceId != null ? f.sources.find((s) => s.sourceId === f.primarySourceId) : null) ??
    f.sources[0] ??
    null
  const verified = row?.verifiedOn ? `, verified ${row.verifiedOn}` : ''
  return `${f.sourceTier} · #${row?.sourceId ?? f.primarySourceId ?? '—'}${verified}`
}

function Row({ item }: { item: ReportFinding }) {
  const { finding, ledger } = item
  return (
    <div className="border border-[#E8E8E4] rounded-lg p-4 bg-white">
      <p className="text-sm font-medium text-[#0F0F0F] break-all">{finding.pageUrl ?? '(site-level)'}</p>
      <p className="text-sm text-[#333] mt-1">{finding.ownerPlainEnglish}</p>
      {finding.whyNotAutoFixed && (
        <p className="text-xs text-[#6B6B6B] mt-2">Why not fixed: {finding.whyNotAutoFixed}</p>
      )}
      {ledger?.prUrl && (
        <p className="text-xs text-[#6B6B6B] mt-2">
          <a href={ledger.prUrl} target="_blank" rel="noopener noreferrer" className="text-orange-600 underline">
            {ledger.prNumber ? `PR #${ledger.prNumber}` : 'Pull request'}
          </a>
          {ledger.mergeSha ? ` · commit ${ledger.mergeSha}` : ''}
          {ledger.productionVerifyOk != null && (
            <> · production {ledger.productionVerifyOk ? 'verified' : 'not verified'}{ledger.productionVerifyAt ? ` ${ledger.productionVerifyAt}` : ''}</>
          )}
        </p>
      )}
      <p className="text-[11px] text-[#9B9B9B] mt-2">{sourceLine(finding)}</p>
    </div>
  )
}

function FixAppliedRow({ item }: { item: FixAppliedEntry }) {
  const { page, plainEnglish, ledger } = item
  return (
    <div className="border border-[#E8E8E4] rounded-lg p-4 bg-white">
      <p className="text-sm font-medium text-[#0F0F0F] break-all">{page ?? '(site-level)'}</p>
      <p className="text-sm text-[#333] mt-1">{plainEnglish}</p>
      <p className="text-xs text-[#6B6B6B] mt-2">
        <a href={ledger.prUrl!} target="_blank" rel="noopener noreferrer" className="text-orange-600 underline">
          {ledger.prNumber ? `PR #${ledger.prNumber}` : 'Pull request'}
        </a>
        {ledger.mergeSha ? ` · commit ${ledger.mergeSha}` : ''}
        {ledger.productionVerifyOk != null && (
          <> · production {ledger.productionVerifyOk ? 'verified' : 'not verified'}{ledger.productionVerifyAt ? ` ${ledger.productionVerifyAt}` : ''}</>
        )}
        {ledger.fixedAt ? ` · fixed ${ledger.fixedAt}` : ''}
      </p>
    </div>
  )
}

function FixesAppliedSection({ items }: { items: FixAppliedEntry[] }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-[#0F0F0F] mb-3">
        Fixes applied <span className="text-[#9B9B9B] font-normal">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-[#9B9B9B]">None in this range.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <FixAppliedRow key={`${item.page}-${i}`} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}

function Section({ title, items }: { title: string; items: ReportFinding[] }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-[#0F0F0F] mb-3">
        {title} <span className="text-[#9B9B9B] font-normal">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-[#9B9B9B]">None in this range.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <Row key={`${item.finding.pageUrl}-${i}`} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}

export default function PublicFixReportPage({ params }: { params: { token: string } }) {
  const [report, setReport] = useState<ShareableReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/public/fix-report/${params.token}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error || 'Report link not found or revoked')
        }
        return r.json() as Promise<ShareableReport>
      })
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load report'))
  }, [params.token])

  if (error) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-8">
        <p className="text-[#6B6B6B] text-sm">{error}</p>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-8">
        <p className="text-[#6B6B6B] text-sm">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8]" style={{ fontFamily: "'Outfit', sans-serif" }}>
      <div className="max-w-2xl mx-auto px-6 py-10">
        <p className="text-[11px] font-semibold text-orange-600 uppercase tracking-wide mb-1">SEORANKO fix report</p>
        <h1 className="text-2xl font-bold text-[#0F0F0F] mb-1">{report.origin}</h1>
        <p className="text-xs text-[#9B9B9B] mb-8">
          {report.from || report.to ? `${report.from ?? '…'} to ${report.to ?? '…'}` : 'All time'} · generated {report.generatedAt}
        </p>

        <Section title="Findings detected" items={report.detected} />
        <FixesAppliedSection items={report.fixesApplied} />
        <Section title="Resolved" items={report.resolved} />
        <Section title="Regressed" items={report.regressed} />
        <Section title="Deliberately not fixed" items={report.notFixed} />

        <p className="text-[11px] text-[#9B9B9B] mt-10 pt-6 border-t border-[#E8E8E4]">
          Read-only. This link can be revoked by the site owner at any time.
        </p>
      </div>
    </div>
  )
}

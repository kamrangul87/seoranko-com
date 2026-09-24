'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { DashboardNav } from '@/components/DashboardNav'
import {
  canOfferFix,
  type FixFlowState,
  type SourceTier,
  type UiFinding,
} from '@/lib/fix-strategies/findings-ui/client'
import { affectedUrlsForFinding } from '@/lib/fix-strategies/findings-ui/affected-urls'

function sourceTierTone(tier: SourceTier): string {
  if (tier === 'STANDARD') return 'text-emerald-800 bg-emerald-50 border-emerald-100'
  if (tier === 'VENDOR-DOCUMENTED')
    return 'text-sky-800 bg-sky-50 border-sky-100'
  if (tier === 'OBSERVED') return 'text-amber-800 bg-amber-50 border-amber-100'
  return 'text-[#6B6B6B] bg-[#F4F4F2] border-[#E8E8E4]'
}

function primarySourceForFinding(f: UiFinding) {
  const id = f.primarySourceId
  return (
    (id != null ? f.sources.find((s) => s.sourceId === id) : null) ??
    f.sources[0] ??
    null
  )
}

export default function FindingDetailPage() {
  const params = useParams()
  const id = String(params?.id ?? '')
  const [finding, setFinding] = useState<UiFinding | null>(null)
  const [fixFlow, setFixFlow] = useState<FixFlowState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showInternal, setShowInternal] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/fix-strategies/findings/${id}`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const body = (await res.json()) as {
        finding: UiFinding
        fixFlow: FixFlowState
      }
      setFinding(body.finding)
      setFixFlow(body.fixFlow)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setFinding(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const offerFix = finding ? canOfferFix(finding.surfaceClass) : false

  return (
    <div
      className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden"
      style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}
    >
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <Link
            href="/dashboard/findings"
            className="text-sm text-[#6B6B6B] hover:text-[#0F0F0F]"
          >
            ← Findings
          </Link>

          {loading && (
            <div className="mt-6 h-40 rounded-[10px] bg-white border border-[#E8E8E4] animate-pulse" />
          )}
          {error && (
            <div className="mt-6 rounded-[10px] border border-red-100 bg-red-50 text-red-800 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {finding && (
            <div className="mt-6 space-y-6">
              <header>
                <p className="text-xs uppercase tracking-wide text-[#9B9B9B] mb-1">
                  Topic {finding.topicId} · {finding.kind}
                </p>
                {finding.ownerPlainEnglish && (
                  <p className="text-lg text-[#0F0F0F] leading-snug mb-2">
                    {finding.ownerPlainEnglish}
                  </p>
                )}
                <h1 className="text-xl font-semibold tracking-tight font-mono">
                  {finding.verdict}
                </h1>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded border ${sourceTierTone(finding.sourceTier)}`}
                  >
                    {finding.sourceTier}
                  </span>
                  {(() => {
                    const row = primarySourceForFinding(finding)
                    const sid = row?.sourceId ?? finding.primarySourceId
                    if (sid == null) return null
                    const verified = row?.verifiedOn
                      ? ` · verified ${row.verifiedOn}`
                      : ''
                    const label = `_sources.md #${sid}${verified}`
                    if (row?.url) {
                      return (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[#FF6B2C] hover:underline"
                        >
                          {label}
                        </a>
                      )
                    }
                    return (
                      <span className="text-xs text-[#6B6B6B]">{label}</span>
                    )
                  })()}
                </div>
                {(() => {
                  const urls = affectedUrlsForFinding(finding)
                  const multi = finding.rolledUp || urls.length > 1
                  if (multi) {
                    return (
                      <div className="mt-2">
                        <p className="text-[#6B6B6B]">
                          {finding.declarationSite ? (
                            <>
                              Component{' '}
                              <span className="font-mono text-[#0F0F0F]">
                                {finding.declarationSite}
                              </span>
                              {' · '}
                            </>
                          ) : null}
                          {finding.affectedUrlCount} URLs affected
                        </p>
                        <ul className="mt-2 space-y-1 text-sm font-mono text-[#6B6B6B]">
                          {urls.map((url) => (
                            <li key={url} className="break-all">
                              {url}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  }
                  return (
                    finding.pageUrl && (
                      <p className="text-[#6B6B6B] mt-2 break-all">
                        {finding.pageUrl}
                      </p>
                    )
                  )
                })()}
              </header>

              <section className="rounded-[10px] border border-[#E8E8E4] bg-white p-5">
                <h2 className="text-sm font-medium mb-2">Observation</h2>
                <p className="text-[#6B6B6B] leading-relaxed">{finding.detail}</p>
                {finding.evidenceValues && (
                  <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    {finding.evidenceValues.left != null && (
                      <div className="rounded-md border border-[#E8E8E4] p-3">
                        <dt className="text-xs text-[#9B9B9B] mb-1">
                          {finding.evidenceValues.leftLabel ?? 'Left'}
                        </dt>
                        <dd className="font-mono break-all">
                          {finding.evidenceValues.left}
                        </dd>
                      </div>
                    )}
                    {finding.evidenceValues.right != null && (
                      <div className="rounded-md border border-[#E8E8E4] p-3">
                        <dt className="text-xs text-[#9B9B9B] mb-1">
                          {finding.evidenceValues.rightLabel ?? 'Right'}
                        </dt>
                        <dd className="font-mono break-all">
                          {finding.evidenceValues.right}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
                {finding.evidenceValues?.relatedFindings &&
                  finding.evidenceValues.relatedFindings.length > 0 && (
                    <div className="mt-4">
                      <h3 className="text-xs uppercase tracking-wide text-[#9B9B9B] mb-2">
                        Related evidence
                        {finding.evidenceValues.rootCause
                          ? ` · ${finding.evidenceValues.rootCause}`
                          : ''}
                      </h3>
                      <ul className="space-y-2 text-sm">
                        {finding.evidenceValues.relatedFindings.map((r, i) => (
                          <li
                            key={`${r.topicId}-${r.verdict}-${i}`}
                            className="rounded-md border border-[#E8E8E4] p-3"
                          >
                            <p className="font-mono text-xs text-[#6B6B6B]">
                              Topic {r.topicId} · {r.verdict}
                              {r.relationship ? ` · ${r.relationship}` : ''}
                            </p>
                            {r.pageUrl && (
                              <p className="font-mono text-xs break-all mt-1">
                                {r.pageUrl}
                              </p>
                            )}
                            <p className="text-[#6B6B6B] mt-1">{r.detail}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
              </section>

              <section className="rounded-[10px] border border-[#E8E8E4] bg-white p-5">
                <h2 className="text-sm font-medium mb-2">Verdict</h2>
                <p className="font-mono text-sm">{finding.verdict}</p>
                <p className="text-sm text-[#6B6B6B] mt-2">
                  Severity: {finding.severity ?? '—'} · Surface:{' '}
                  {finding.surfaceClass}
                  {finding.reportOnly ? ' · report-only' : ''}
                </p>
              </section>

              {finding.proposedDiff && (
                <section className="rounded-[10px] border border-[#E8E8E4] bg-white p-5">
                  <h2 className="text-sm font-medium mb-2">Proposed change</h2>
                  <p className="text-sm text-[#6B6B6B] mb-3">
                    {finding.proposedDiff.summary}
                    {finding.proposedDiff.targetPath && (
                      <>
                        {' '}
                        · target{' '}
                        <span className="font-mono text-[#0F0F0F]">
                          {finding.proposedDiff.targetPath}
                        </span>
                      </>
                    )}
                  </p>
                  {(finding.proposedDiff.before || finding.proposedDiff.after) && (
                    <div className="grid grid-cols-1 gap-3 text-xs font-mono">
                      {finding.proposedDiff.before && (
                        <pre className="rounded-md bg-red-50 border border-red-100 p-3 overflow-x-auto whitespace-pre-wrap">
                          − {finding.proposedDiff.before}
                        </pre>
                      )}
                      {finding.proposedDiff.after && (
                        <pre className="rounded-md bg-emerald-50 border border-emerald-100 p-3 overflow-x-auto whitespace-pre-wrap">
                          + {finding.proposedDiff.after}
                        </pre>
                      )}
                    </div>
                  )}
                  {(finding.surfaceClass === 'human-review' ||
                    finding.surfaceClass === 'finding' ||
                    finding.reportOnly) && (
                    <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 mt-3">
                      {finding.surfaceClass === 'human-review'
                        ? 'Human review — evidence and proposal shown for your decision. Never applied automatically.'
                        : 'Not auto-fixable — proposal shown for decision only. Never applied automatically.'}
                    </p>
                  )}
                </section>
              )}

              {!finding.proposedDiff &&
                (finding.surfaceClass === 'human-review' ||
                  finding.surfaceClass === 'finding') && (
                  <section className="rounded-[10px] border border-amber-100 bg-amber-50 p-5">
                    <h2 className="text-sm font-medium mb-2 text-amber-950">
                      Awaiting your decision
                    </h2>
                    <p className="text-sm text-amber-900/80">
                      This finding is not auto-fixable. Review the observation
                      and evidence above — no change will be applied until you
                      decide.
                    </p>
                  </section>
                )}

              {finding.whyNotAutoFixed && (
                <section className="rounded-[10px] border border-[#E8E8E4] bg-white p-5">
                  <h2 className="text-sm font-medium mb-2">
                    Why SEORANKO did not fix this
                  </h2>
                  <p className="text-[#6B6B6B] leading-relaxed">
                    {finding.whyNotAutoFixed}
                  </p>
                </section>
              )}

              <section className="rounded-[10px] border border-[#E8E8E4] bg-white p-5">
                <h2 className="text-sm font-medium mb-3">Sources</h2>
                {finding.sources.length === 0 ? (
                  <p className="text-sm text-[#9B9B9B]">
                    No primary source rows linked for this dossier yet.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {finding.sources.map((s) => (
                      <li key={s.sourceId} className="text-sm">
                        {s.url ? (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#FF6B2C] hover:underline break-all"
                          >
                            {s.url}
                          </a>
                        ) : (
                          <span className="text-[#6B6B6B]">
                            Product / absence-of-spec (#{s.sourceId})
                          </span>
                        )}
                        <p className="text-[#6B6B6B] mt-0.5">
                          {s.section}
                          {s.verifiedOn ? ` · verified ${s.verifiedOn}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-[10px] border border-[#E8E8E4] bg-white p-5">
                <button
                  type="button"
                  className="text-sm text-[#6B6B6B] hover:text-[#0F0F0F]"
                  onClick={() => setShowInternal((v) => !v)}
                >
                  {showInternal ? 'Hide' : 'Show'} what SEORANKO checked and left
                  alone
                  {finding.internalEvidence.length > 0
                    ? ` (${finding.internalEvidence.length})`
                    : ''}
                </button>
                {showInternal && (
                  <ul className="mt-3 space-y-2 text-sm">
                    {finding.internalEvidence.length === 0 ? (
                      <li className="text-[#9B9B9B]">
                        No suppress / ok / route rows attached to this finding.
                      </li>
                    ) : (
                      finding.internalEvidence.map((e, i) => (
                        <li
                          key={`${e.verdict}-${i}`}
                          className="rounded-md border border-[#E8E8E4] bg-[#F4F4F2] px-3 py-2"
                        >
                          <p className="text-[#0F0F0F] leading-snug">
                            {e.whyNotFixed ?? e.detail}
                          </p>
                          <p className="font-mono text-xs text-[#6B6B6B] mt-1">
                            {e.verdict}
                          </p>
                          {e.detail && e.whyNotFixed && e.detail !== e.whyNotFixed && (
                            <p className="text-[#6B6B6B] mt-1 text-xs">
                              {e.detail}
                            </p>
                          )}
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </section>

              <div className="flex flex-wrap gap-3">
                {offerFix ? (
                  <Link
                    href={`/dashboard/findings/${finding.id}/fix`}
                    className="inline-flex items-center px-4 py-2 rounded-md bg-[#FF6B2C] text-white text-sm font-medium hover:opacity-90"
                  >
                    Fix
                  </Link>
                ) : (
                  <span
                    className="inline-flex items-center px-4 py-2 rounded-md border border-[#E8E8E4] text-[#9B9B9B] text-sm"
                    title="Report-only and human-review findings do not offer auto-apply"
                  >
                    No auto-fix
                  </span>
                )}
                {fixFlow && fixFlow.step !== 'idle' && (
                  <span className="text-sm text-[#6B6B6B] self-center">
                    Fix flow: {fixFlow.step}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

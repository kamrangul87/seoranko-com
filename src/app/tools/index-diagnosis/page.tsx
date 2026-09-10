'use client'

import { FormEvent, useMemo, useState } from 'react'
import Link from 'next/link'

type TopCause = {
  reason: string
  affectedUrlCount: number
  exampleUrl: string
  headline: string
  explanation: string
  action?: string
  autoFixable?: boolean
}

type UrlRow = {
  url: string
  reason: string
  httpStatus: number | null
  robotsRuleLine: string | null
  metaRobots: string | null
  xRobotsTag: string | null
  canonicalTarget: string | null
  canonicalIsSelf: boolean | null
  crawlDepth: number | null
  internalInlinkCount: number | null
  mainContentWordCount: number | null
  evidenceNotes: string
}

type ScanOk = {
  ok: true
  scanId: string | null
  domain: string
  scannedAt: string
  urlsDiscovered: number
  urlsFetched: number
  partial: boolean
  topCauses: TopCause[]
  indexableCount: number
  problemCount: number
  urlCount: number
  siteTooLarge?: boolean
  terminationEvidence?: string
  urlsUnlocked: boolean
  urls: UrlRow[]
}

type ScanErr = {
  ok: false
  code?: string
  message: string
}

export default function PublicIndexDiagnosisPage() {
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [result, setResult] = useState<ScanOk | null>(null)
  const [email, setEmail] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)

  const urlCountLabel = useMemo(() => {
    if (!result) return ''
    return `${result.urlCount} URL${result.urlCount === 1 ? '' : 's'}`
  }, [result])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setErrorCode(null)
    setResult(null)
    setTableOpen(false)
    try {
      const res = await fetch('/api/public/index-diagnosis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      })
      const data = (await res.json()) as ScanOk | ScanErr
      if (!data.ok) {
        setError(data.message || 'Scan failed')
        setErrorCode(data.code || null)
        return
      }
      setResult(data)
    } catch {
      setError('Could not reach SEORANKO. Check your connection and try again.')
      setErrorCode('unreachable')
    } finally {
      setLoading(false)
    }
  }

  async function onUnlock(e: FormEvent) {
    e.preventDefault()
    if (!result?.scanId) {
      setError('Scan could not be saved — full table unlock is unavailable right now.')
      return
    }
    setUnlocking(true)
    setError(null)
    try {
      const res = await fetch('/api/public/index-diagnosis/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId: result.scanId, email }),
      })
      const data = await res.json()
      if (!data.ok) {
        setError(data.message || 'Could not unlock')
        return
      }
      setResult({
        ...result,
        urlsUnlocked: true,
        urls: Array.isArray(data.urls) ? data.urls : [],
        urlCount: data.urlCount ?? result.urlCount,
      })
      setTableOpen(true)
    } catch {
      setError('Could not unlock the full report. Try again.')
    } finally {
      setUnlocking(false)
    }
  }

  return (
    <div
      className="min-h-screen bg-[#FAFAF8] text-[#0F0F0F]"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      <header className="border-b border-[#E8E8E4] bg-white">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-[#FF6B2C] rounded-[7px] flex items-center justify-center">
              <span className="text-[#0a0a0a] font-extrabold text-xs">S</span>
            </div>
            <span className="font-bold text-base tracking-tight">Seoranko</span>
          </Link>
          <Link href="/signup" className="text-sm text-[#FF6B2C] font-medium hover:underline">
            Start free →
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#9B9B9B] mb-2">
          Free tool
        </p>
        <h1 className="text-3xl font-semibold tracking-tight mb-3">Index Diagnosis</h1>
        <p className="text-[#6B6B6B] text-base mb-8 leading-relaxed">
          Enter a domain. SEORANKO crawls it (respecting robots.txt) and returns the top reasons
          pages may not be indexable — with mechanical evidence, not AI guesses.
        </p>

        <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-2 mb-6">
          <input
            className="flex-1 border border-[#E5E5E5] rounded-lg px-3 py-2.5 bg-white text-sm"
            placeholder="example.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={loading}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={loading || !domain.trim()}
            className="px-5 py-2.5 rounded-lg bg-[#FF6B2C] text-white text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Scanning…' : 'Diagnose indexing'}
          </button>
        </form>

        {loading && (
          <p className="text-sm text-[#6B6B6B] mb-6">
            Crawling up to 200 URLs (about a minute). Partial results are returned if the time budget
            runs out.
          </p>
        )}

        {error && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm mb-6 ${
              errorCode === 'rate_limited' || errorCode === 'busy'
                ? 'border-amber-200 bg-amber-50 text-amber-950'
                : errorCode === 'robots_blocks_all'
                  ? 'border-orange-200 bg-orange-50 text-orange-950'
                  : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-8">
            <div>
              <p className="text-sm text-[#6B6B6B] mb-1">
                Results for <span className="font-medium text-[#0F0F0F]">{result.domain}</span>
                {' · '}
                {result.urlsFetched} fetched / {result.urlsDiscovered} discovered
                {result.partial ? ' · partial crawl' : ''}
              </p>
              {result.siteTooLarge && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                  This site is large — we hit the 200-URL discovery cap. Treat this as a sample of
                  the highest-priority crawl paths, not a full inventory.
                </p>
              )}
            </div>

            <section>
              <h2 className="text-lg font-semibold mb-3">Top reasons pages may not be indexed</h2>
              {result.topCauses.length === 0 ? (
                <p className="text-sm text-[#6B6B6B]">
                  No blocking or at-risk patterns found in this crawl sample ({result.indexableCount}{' '}
                  indexable URL{result.indexableCount === 1 ? '' : 's'}).
                </p>
              ) : (
                <ol className="space-y-4">
                  {result.topCauses.map((c, i) => (
                    <li
                      key={c.reason}
                      className="border border-[#E8E8E4] rounded-xl bg-white p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="text-xs font-semibold text-[#9B9B9B] uppercase tracking-wide">
                          #{i + 1} · {c.reason.replace(/_/g, ' ')} · {c.affectedUrlCount} URL
                          {c.affectedUrlCount === 1 ? '' : 's'}
                        </p>
                        {c.autoFixable ? (
                          <span className="inline-flex items-center rounded-md border border-[#FF6B2C]/40 bg-[#FFF4EE] px-2 py-0.5 text-[11px] font-semibold text-[#C24A12]">
                            Auto-fixable with a free account
                          </span>
                        ) : null}
                      </div>
                      <p className="font-semibold text-[#0F0F0F] mb-1">{c.headline}</p>
                      <p className="text-sm text-[#6B6B6B] leading-relaxed mb-2">{c.explanation}</p>
                      {c.action ? (
                        <p className="text-sm text-[#0F0F0F] leading-relaxed mb-3">
                          <span className="font-medium">What to change: </span>
                          {c.action}
                        </p>
                      ) : null}
                      <p className="text-sm text-[#6B6B6B]">
                        {c.autoFixable
                          ? 'Fix Agent can apply this automatically — '
                          : 'Track and fix this in SEORANKO — '}
                        <Link href="/signup" className="text-[#FF6B2C] font-medium hover:underline">
                          create a free account
                        </Link>
                        .
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="border border-[#E8E8E4] rounded-xl bg-white p-5">
              <h2 className="text-base font-semibold mb-1">Get the full report</h2>
              <p className="text-sm text-[#6B6B6B] mb-4">
                Unlock the evidence table for all {urlCountLabel} (HTTP status, robots rule, meta
                robots, canonical, depth, inlinks).
              </p>
              {!result.urlsUnlocked ? (
                <form onSubmit={onUnlock} className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="email"
                    required
                    className="flex-1 border border-[#E5E5E5] rounded-lg px-3 py-2 text-sm"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={unlocking || !result.scanId}
                  />
                  <button
                    type="submit"
                    disabled={unlocking || !email.trim() || !result.scanId}
                    className="px-4 py-2 rounded-lg bg-[#0F0F0F] text-white text-sm font-medium disabled:opacity-50"
                  >
                    {unlocking ? 'Unlocking…' : 'Show full table'}
                  </button>
                </form>
              ) : (
                <p className="text-sm text-green-800">Full URL table unlocked for this scan.</p>
              )}
              <p className="text-[11px] text-[#9B9B9B] mt-3">
                We store your email on this scan only. No message is sent.
              </p>
            </section>

            {result.urlsUnlocked && (
              <section>
                <button
                  type="button"
                  className="text-sm font-medium text-[#FF6B2C] hover:underline mb-3"
                  onClick={() => setTableOpen((o) => !o)}
                >
                  {tableOpen ? 'Hide' : 'Show'} per-URL evidence ({result.urls.length})
                </button>
                {tableOpen && (
                  <div className="overflow-x-auto border border-[#E8E8E4] rounded-xl bg-white">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-[#F5F4F1] text-[#6B6B6B]">
                        <tr>
                          <th className="px-3 py-2 font-medium">URL</th>
                          <th className="px-3 py-2 font-medium">Reason</th>
                          <th className="px-3 py-2 font-medium">HTTP</th>
                          <th className="px-3 py-2 font-medium">Depth</th>
                          <th className="px-3 py-2 font-medium">Inlinks</th>
                          <th className="px-3 py-2 font-medium">Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.urls.map((u) => (
                          <tr key={u.url} className="border-t border-[#E8E8E4] align-top">
                            <td className="px-3 py-2 max-w-[220px] break-all">{u.url}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{u.reason}</td>
                            <td className="px-3 py-2">{u.httpStatus ?? '—'}</td>
                            <td className="px-3 py-2">{u.crawlDepth ?? '—'}</td>
                            <td className="px-3 py-2">{u.internalInlinkCount ?? '—'}</td>
                            <td className="px-3 py-2 text-[#6B6B6B]">
                              <div>{u.evidenceNotes}</div>
                              {u.robotsRuleLine && (
                                <div className="mt-1">robots: {u.robotsRuleLine}</div>
                              )}
                              {u.metaRobots && <div>meta: {u.metaRobots}</div>}
                              {u.xRobotsTag && <div>header: {u.xRobotsTag}</div>}
                              {u.canonicalTarget && (
                                <div>
                                  canonical: {u.canonicalTarget}
                                  {u.canonicalIsSelf === true
                                    ? ' (self)'
                                    : u.canonicalIsSelf === false
                                      ? ' (other)'
                                      : ''}
                                </div>
                              )}
                              {u.mainContentWordCount != null && (
                                <div>words: {u.mainContentWordCount}</div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            <p className="text-sm text-[#6B6B6B] pt-2">
              Want continuous audits, Fix Agent, and Google Search Console status?{' '}
              <Link href="/signup" className="text-[#FF6B2C] font-medium hover:underline">
                Create a free SEORANKO account
              </Link>
              .
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

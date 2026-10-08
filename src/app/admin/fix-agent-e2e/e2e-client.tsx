'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type E2eRun = {
  id: string
  status: string
  current_step: string | null
  first_failing_step: string | null
  fail_reason: string | null
  seed_sha: string | null
  merge_sha: string | null
  consecutive_pass_days: number | null
  started_at: string
  finished_at: string | null
  steps?: Array<{
    name: string
    status: string
    detail?: string
    error?: string
  }>
}

export function FixAgentE2eClient() {
  const [days, setDays] = useState<number | null>(null)
  const [active, setActive] = useState<E2eRun | null>(null)
  const [recent, setRecent] = useState<E2eRun[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [readmeDiff, setReadmeDiff] = useState<unknown>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/fix-agent-e2e')
    const json = (await res.json()) as {
      error?: string
      consecutivePassingDays?: number
      active?: E2eRun | null
      recent?: E2eRun[]
      readmeDiff?: unknown
    }
    if (!res.ok) {
      setError(json.error || 'Failed to load')
      return
    }
    setError(null)
    setDays(json.consecutivePassingDays ?? 0)
    setActive(json.active ?? null)
    setRecent(json.recent ?? [])
    setReadmeDiff(json.readmeDiff ?? null)
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 8000)
    return () => clearInterval(t)
  }, [refresh])

  async function runNow() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/fix-agent-e2e', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run_now' }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error || 'Run now failed')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Run now failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-[#6B6B6B]">
            <Link href="/admin/github-app-setup" className="underline">
              Admin
            </Link>
            {' / '}
            Fix Agent e2e
          </p>
          <h1 className="text-2xl font-semibold mt-1">Fix Agent e2e</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">
            Permanent fixture check against seoranko-fixture (seed → crawl → fix
            → merge → recrawl). Master only. Fix my site stays gated.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || active?.status === 'running'}
          onClick={() => void runNow()}
          className="px-4 py-2 rounded-lg bg-[#FF6B2C] text-white text-sm font-medium disabled:opacity-50"
          data-testid="e2e-run-now"
        >
          {busy ? 'Starting…' : 'Run now'}
        </button>
      </div>

      <div
        data-testid="e2e-consecutive-days"
        className="rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-4"
      >
        <p className="text-xs text-[#6B6B6B]">Consecutive passing e2e days</p>
        <p className="text-3xl font-semibold mt-1">{days ?? '—'}</p>
      </div>

      {error && (
        <div className="rounded-[10px] border border-red-100 bg-red-50 text-red-800 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {active && (
        <section className="rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-4 space-y-2">
          <p className="text-sm font-medium">Active run</p>
          <p className="text-xs font-mono text-[#6B6B6B]">{active.id}</p>
          <p className="text-sm">
            {active.status} · step {active.current_step || '—'}
          </p>
          {active.fail_reason && (
            <p className="text-sm text-red-700">{active.fail_reason}</p>
          )}
          <ul className="text-xs space-y-1 mt-2">
            {(active.steps || []).map((s) => (
              <li key={s.name}>
                <span className="font-mono">{s.name}</span> — {s.status}
                {s.detail ? `: ${s.detail}` : ''}
                {s.error ? ` (${s.error})` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <p className="text-sm font-medium">Recent runs</p>
        <ul className="space-y-2">
          {recent.map((r) => (
            <li
              key={r.id}
              className="rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-3 text-sm"
            >
              <div className="flex justify-between gap-2">
                <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>
                <span>{r.status}</span>
              </div>
              <p className="text-xs text-[#6B6B6B] mt-1">
                {r.started_at}
                {r.first_failing_step
                  ? ` · fail ${r.first_failing_step}: ${r.fail_reason}`
                  : ''}
              </p>
            </li>
          ))}
          {recent.length === 0 && (
            <li className="text-sm text-[#6B6B6B]">No runs yet.</li>
          )}
        </ul>
      </section>

      {readmeDiff != null && (
        <section className="rounded-[10px] border border-[#E8E8E4] bg-white px-4 py-4">
          <p className="text-sm font-medium mb-2">expected.json vs README</p>
          <pre className="text-xs whitespace-pre-wrap text-[#6B6B6B]">
            {JSON.stringify(readmeDiff, null, 2)}
          </pre>
        </section>
      )}
    </div>
  )
}

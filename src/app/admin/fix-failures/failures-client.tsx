'use client'

import { useCallback, useEffect, useState } from 'react'

type SignatureRow = {
  signature: string
  signatureHash: string
  topic: string
  verdict: string
  stage: string
  count: number
  lastSeenAt: string
}

type PausedRow = {
  topic: string
  verdict: string
  pausedReason: string | null
  pausedAt: string | null
  canResume: boolean
}

export function FixFailuresClient() {
  const [signatures, setSignatures] = useState<SignatureRow[]>([])
  const [paused, setPaused] = useState<PausedRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const res = await fetch('/api/admin/fix-failures')
    const json = (await res.json()) as {
      ok?: boolean
      error?: string
      signatures?: SignatureRow[]
      paused?: PausedRow[]
    }
    if (!res.ok || !json.ok) {
      setError(json.error || 'Load failed')
      return
    }
    setSignatures(json.signatures ?? [])
    setPaused(json.paused ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function resume(topic: string, verdict: string) {
    setBusy(`${topic}|${verdict}`)
    setError(null)
    try {
      const res = await fetch('/api/admin/fix-failures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume', topic, verdict }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(json.error || 'Resume failed')
        return
      }
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <header>
        <p className="text-xs uppercase tracking-wide text-[#6B6B6B]">Admin</p>
        <h1 className="text-2xl font-bold mt-1">Fix Agent failures</h1>
        <p className="text-sm text-[#6B6B6B] mt-2">
          Failure signatures and paused auto-fix types. Resume only after e2e
          has passed since the pause.
        </p>
      </header>

      {error && (
        <p className="text-sm text-[#791F1F] bg-[#FCEBEB] px-3 py-2 rounded">
          {error}
        </p>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">Paused fix types</h2>
        {paused.length === 0 ? (
          <p className="text-sm text-[#6B6B6B]">None paused.</p>
        ) : (
          <ul className="space-y-3">
            {paused.map((p) => (
              <li
                key={`${p.topic}|${p.verdict}`}
                className="border border-[#E5E5E5] bg-white px-4 py-3 flex items-start justify-between gap-4"
              >
                <div>
                  <p className="font-medium">
                    {p.topic} / {p.verdict}
                  </p>
                  <p className="text-xs text-[#6B6B6B] mt-1">
                    {p.pausedReason || 'Paused'}
                    {p.pausedAt ? ` · since ${p.pausedAt.slice(0, 10)}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!p.canResume || busy === `${p.topic}|${p.verdict}`}
                  onClick={() => void resume(p.topic, p.verdict)}
                  className="text-sm px-3 py-1.5 bg-[#0F0F0F] text-white disabled:opacity-40"
                >
                  {p.canResume ? 'Resume' : 'Resume (needs e2e pass)'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Signatures</h2>
        {signatures.length === 0 ? (
          <p className="text-sm text-[#6B6B6B]">No failures recorded yet.</p>
        ) : (
          <div className="overflow-x-auto border border-[#E5E5E5] bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#6B6B6B] border-b border-[#E5E5E5]">
                  <th className="px-3 py-2">Topic / verdict</th>
                  <th className="px-3 py-2">Stage</th>
                  <th className="px-3 py-2">Count</th>
                  <th className="px-3 py-2">Last seen</th>
                  <th className="px-3 py-2">Hash</th>
                </tr>
              </thead>
              <tbody>
                {signatures.map((s) => (
                  <tr
                    key={s.signatureHash}
                    className="border-b border-[#F0F0F0] align-top"
                  >
                    <td className="px-3 py-2">
                      {s.topic} / {s.verdict}
                    </td>
                    <td className="px-3 py-2">{s.stage}</td>
                    <td className="px-3 py-2">{s.count}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {s.lastSeenAt.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {s.signatureHash}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

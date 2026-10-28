'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'

type ReceiptRow = {
  itemId: string
  pageUrl: string | null
  plainEnglish: string
  prUrl: string | null
  prNumber: number | null
  productionVerifiedAt: string | null
  sharePath: string | null
}

export default function FixReceiptsPage() {
  const [siteId, setSiteId] = useState<string | null>(null)
  const [receipts, setReceipts] = useState<ReceiptRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [recoverableRuns, setRecoverableRuns] = useState<
    Array<{ id: string; prNumber: number | null; prUrl: string | null; createdAt: string; errorDetail?: string | null }>
  >([])
  const [recoveringRunId, setRecoveringRunId] = useState<string | null>(null)
  const [recoverMsg, setRecoverMsg] = useState<string | null>(null)

  useEffect(() => {
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    ;(async () => {
      const { data: sites } = await sb
        .from('connected_sites')
        .select('id')
        .order('is_primary', { ascending: false })
        .limit(1)
      const id = sites?.[0]?.id as string | undefined
      if (!id) {
        setLoading(false)
        setError('Connect a site first.')
        return
      }
      setSiteId(id)
    })()
  }, [])

  const load = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/fix-strategies/receipts?siteId=${encodeURIComponent(id)}`,
      )
      const body = (await res.json()) as {
        receipts?: ReceiptRow[]
        error?: string
      }
      if (!res.ok) {
        setError(body.error || 'Could not load receipts')
        setReceipts([])
        return
      }
      setReceipts(body.receipts || [])
    } catch {
      setError('Could not load receipts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (siteId) void load(siteId)
  }, [siteId, load])

  useEffect(() => {
    if (!siteId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/fix-strategies/runs?siteId=${encodeURIComponent(siteId)}&includeLastFailed=1`,
        )
        const json = (await res.json()) as {
          recoverable?: Array<{
            id: string
            prNumber: number | null
            prUrl: string | null
            createdAt: string
            errorDetail?: string | null
          }>
        }
        if (!cancelled) setRecoverableRuns(json.recoverable || [])
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [siteId])

  async function recover(runId: string) {
    if (!runId || recoveringRunId) return
    setRecoverMsg(null)
    setRecoveringRunId(runId)
    try {
      const res = await fetch(`/api/fix-strategies/runs/${runId}/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recover' }),
      })
      const ok = res.ok
      if (!ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || 'Recover failed')
      }
      setRecoverMsg('Checked again — reloading receipts…')
      if (siteId) await load(siteId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recover failed')
    } finally {
      setRecoveringRunId(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#0F0F0F]">Fix Receipts</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">
          Verified live fixes for this site. Private by default — create a share
          link on a receipt when you want to send proof.
        </p>
      </div>

      {loading && <p className="text-sm text-[#6B6B6B]">Loading…</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}

      {!loading && !error && receipts.length === 0 && (
        <div className="space-y-3">
          <p className="text-sm text-[#6B6B6B]">
            No verified fixes yet. Run an audit and Fix my site from{' '}
            <Link href="/dashboard/findings" className="underline text-orange-700">
              Audit
            </Link>
            .
          </p>
          {recoverableRuns.length > 0 && (
            <div className="rounded-lg border border-[#E8E8E4] bg-white p-4">
              <p className="text-sm font-medium text-[#0F0F0F]">Recover receipts</p>
              <p className="text-xs text-[#6B6B6B] mt-1">
                We found a previous Fix PR for this site. If you merged it already, check again to verify live and get a receipt.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void recover(recoverableRuns[0]!.id)}
                  disabled={Boolean(recoveringRunId)}
                  className="px-3 py-1.5 rounded bg-[#0F0F0F] text-white text-xs disabled:opacity-50"
                >
                  {recoveringRunId ? 'Checking…' : 'PR merged? Check again & get receipt'}
                </button>
                {recoverMsg && (
                  <span className="text-xs text-[#6B6B6B]">{recoverMsg}</span>
                )}
                {recoverableRuns[0]!.prNumber != null && recoverableRuns[0]!.prUrl && (
                  <a
                    href={recoverableRuns[0]!.prUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#FF6B2C] underline"
                  >
                    PR #{recoverableRuns[0]!.prNumber}
                  </a>
                )}
              </div>
              {recoverableRuns[0]!.errorDetail && (
                <p className="mt-2 text-[11px] text-[#9B9B9B]">
                  Last run finished with: {recoverableRuns[0]!.errorDetail}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <ul className="space-y-3">
        {receipts.map((r) => (
          <li
            key={r.itemId}
            className="border border-[#E8E8E4] rounded-lg bg-white p-4"
          >
            <Link
              href={`/dashboard/receipts/${r.itemId}`}
              className="text-sm font-medium text-[#0F0F0F] hover:underline"
            >
              {r.plainEnglish}
            </Link>
            {r.pageUrl && (
              <p className="text-xs text-[#6B6B6B] mt-1 break-all">{r.pageUrl}</p>
            )}
            <p className="text-xs text-[#9B9B9B] mt-2">
              {r.productionVerifiedAt
                ? `Verified ${new Date(r.productionVerifiedAt).toLocaleString()}`
                : 'Verified live'}
              {r.prNumber ? ` · PR #${r.prNumber}` : ''}
              {r.sharePath ? ' · share link on' : ' · private'}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

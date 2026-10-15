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
        <p className="text-sm text-[#6B6B6B]">
          No verified fixes yet. Run an audit and Fix my site from{' '}
          <Link href="/dashboard/findings" className="underline text-orange-700">
            Audit
          </Link>
          .
        </p>
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

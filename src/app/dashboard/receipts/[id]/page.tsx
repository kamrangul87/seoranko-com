'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

type Receipt = {
  itemId: string
  siteId?: string
  pageUrl: string | null
  plainEnglish: string
  path: string | null
  commitSha: string | null
  prUrl: string | null
  prNumber: number | null
  mergeSha: string | null
  previewVerifiedAt: string | null
  productionVerifiedAt: string | null
  sharePath: string | null
  shareToken: string | null
  status: string
}

export default function FixReceiptDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [beforeAfter, setBeforeAfter] = useState<{
    baseline: { impressions: number; clicks: number; avg_position: number | null }
    observation: { impressions: number; clicks: number; avg_position: number | null }
    missingObservationDays: number
    totalObservationDays: number
    requiredObservationDays: number
    label: string
    message: string
  } | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/fix-strategies/receipts/${id}`)
      const body = (await res.json()) as { receipt?: Receipt; error?: string }
      if (!res.ok) {
        setError(body.error || 'Not found')
        setReceipt(null)
        return
      }
      setReceipt(body.receipt || null)
    } catch {
      setError('Could not load receipt')
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!receipt?.siteId || !receipt.pageUrl) return
    const appliedAt = receipt.productionVerifiedAt
    if (!appliedAt) return
    void (async () => {
      try {
        const res = await fetch(
          `/api/gsc/before-after?siteId=${encodeURIComponent(
            receipt.siteId!,
          )}&url=${encodeURIComponent(receipt.pageUrl!)}&appliedAt=${encodeURIComponent(appliedAt)}`,
        )
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not load Search Console change')
        setBeforeAfter(data)
      } catch {
        setBeforeAfter(null)
      }
    })()
  }, [receipt])

  async function shareAction(action: 'share' | 'revoke') {
    setBusy(true)
    setCopied(false)
    try {
      const res = await fetch(`/api/fix-strategies/receipts/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = (await res.json()) as { receipt?: Receipt; error?: string }
      if (!res.ok) {
        setError(body.error || 'Action failed')
        return
      }
      setReceipt(body.receipt || null)
    } catch {
      setError('Action failed')
    } finally {
      setBusy(false)
    }
  }

  async function copyShare() {
    if (!receipt?.sharePath) return
    const url = `${window.location.origin}${receipt.sharePath}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
  }

  if (error && !receipt) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-sm text-red-700">{error}</p>
        <Link href="/dashboard/receipts" className="text-sm underline mt-4 inline-block">
          Back to receipts
        </Link>
      </div>
    )
  }

  if (!receipt) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-sm text-[#6B6B6B]">Loading…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <Link href="/dashboard/receipts" className="text-xs text-[#6B6B6B] underline">
        All receipts
      </Link>
      <div>
        <p className="text-xs uppercase tracking-wide text-[#9B9B9B]">
          Fix Receipt · private
        </p>
        <h1 className="text-2xl font-semibold text-[#0F0F0F] mt-1">
          {receipt.plainEnglish}
        </h1>
        {receipt.pageUrl && (
          <p className="text-sm text-[#333] mt-2 break-all">{receipt.pageUrl}</p>
        )}
      </div>

      <dl className="space-y-3 text-sm border border-[#E8E8E4] rounded-lg bg-white p-4">
        {receipt.path && (
          <div>
            <dt className="text-xs text-[#9B9B9B]">File changed</dt>
            <dd className="font-mono text-xs mt-0.5">{receipt.path}</dd>
          </div>
        )}
        {receipt.commitSha && (
          <div>
            <dt className="text-xs text-[#9B9B9B]">Commit</dt>
            <dd className="font-mono text-xs mt-0.5">{receipt.commitSha}</dd>
          </div>
        )}
        {receipt.prUrl && (
          <div>
            <dt className="text-xs text-[#9B9B9B]">Pull request</dt>
            <dd className="mt-0.5">
              <a
                href={receipt.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-700 underline"
              >
                {receipt.prNumber ? `PR #${receipt.prNumber}` : 'Open PR'}
              </a>
              {receipt.mergeSha ? ` · merge ${receipt.mergeSha.slice(0, 7)}` : ''}
            </dd>
          </div>
        )}
        {receipt.productionVerifiedAt && (
          <div>
            <dt className="text-xs text-[#9B9B9B]">Verified live</dt>
            <dd className="mt-0.5">
              {new Date(receipt.productionVerifiedAt).toLocaleString()}
            </dd>
          </div>
        )}
      </dl>

      {receipt.pageUrl && beforeAfter && (
        <div className="space-y-2 border border-[#E8E8E4] rounded-lg bg-white p-4">
          <p className="text-sm font-medium text-[#0F0F0F]">Search Console — observed change</p>
          <p className="text-xs text-[#6B6B6B]">{beforeAfter.label}</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-[#9B9B9B]">Before (28 days)</div>
              <div className="text-[#0F0F0F]">
                Impr. {beforeAfter.baseline.impressions.toLocaleString()} · Clicks{' '}
                {beforeAfter.baseline.clicks.toLocaleString()} · Avg pos{' '}
                {beforeAfter.baseline.avg_position != null
                  ? beforeAfter.baseline.avg_position.toFixed(1)
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#9B9B9B]">After (since merge)</div>
              <div className="text-[#0F0F0F]">
                Impr. {beforeAfter.observation.impressions.toLocaleString()} · Clicks{' '}
                {beforeAfter.observation.clicks.toLocaleString()} · Avg pos{' '}
                {beforeAfter.observation.avg_position != null
                  ? beforeAfter.observation.avg_position.toFixed(1)
                  : '—'}
              </div>
            </div>
          </div>
          {beforeAfter.missingObservationDays > 0 ? (
            <p className="text-xs text-[#9B9B9B]">{beforeAfter.message}</p>
          ) : (
            <p className="text-xs text-[#9B9B9B]">{beforeAfter.message}</p>
          )}
        </div>
      )}

      <div className="space-y-3 border border-[#E8E8E4] rounded-lg bg-white p-4">
        <p className="text-sm font-medium text-[#0F0F0F]">Share link</p>
        <p className="text-xs text-[#6B6B6B]">
          Receipts are private until you create a share link. Revoke anytime —
          the public URL stops working immediately.
        </p>
        {receipt.sharePath ? (
          <div className="flex flex-wrap gap-2 items-center">
            <code className="text-xs bg-[#FAFAF8] px-2 py-1 rounded break-all">
              {receipt.sharePath}
            </code>
            <button
              type="button"
              onClick={() => void copyShare()}
              className="text-xs px-3 py-1.5 rounded border border-[#E8E8E4]"
            >
              {copied ? 'Copied' : 'Copy URL'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void shareAction('revoke')}
              className="text-xs px-3 py-1.5 rounded border border-[#E8E8E4] text-red-700"
            >
              Revoke
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy || receipt.status !== 'verified_live'}
            onClick={() => void shareAction('share')}
            className="text-xs px-3 py-1.5 rounded bg-[#0F0F0F] text-white disabled:opacity-50"
          >
            Create share link
          </button>
        )}
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </div>
  )
}

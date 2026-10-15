'use client'

import { useEffect, useState } from 'react'

type PublicReceipt = {
  pageUrl: string | null
  plainEnglish: string
  path: string | null
  commitSha: string | null
  prUrl: string | null
  prNumber: number | null
  mergeSha: string | null
  previewVerifiedAt: string | null
  productionVerifiedAt: string | null
  createdAt: string
}

export default function PublicFixReceiptPage({
  params,
}: {
  params: { token: string }
}) {
  const [receipt, setReceipt] = useState<PublicReceipt | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/public/receipt/${params.token}`)
        const body = (await res.json()) as {
          receipt?: PublicReceipt
          error?: string
        }
        if (!res.ok) {
          if (!cancelled) setError(body.error || 'Not found')
          return
        }
        if (!cancelled) setReceipt(body.receipt || null)
      } catch {
        if (!cancelled) setError('Could not load receipt')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [params.token])

  if (error) {
    return (
      <main className="min-h-screen bg-[#FAFAF8] px-6 py-16">
        <div className="mx-auto max-w-xl">
          <p className="text-sm text-[#6B6B6B]">{error}</p>
        </div>
      </main>
    )
  }

  if (!receipt) {
    return (
      <main className="min-h-screen bg-[#FAFAF8] px-6 py-16">
        <div className="mx-auto max-w-xl">
          <p className="text-sm text-[#6B6B6B]">Loading…</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#FAFAF8] px-6 py-16">
      <div className="mx-auto max-w-xl space-y-6">
        <p className="text-xs uppercase tracking-wide text-[#9B9B9B]">
          Fix Receipt
        </p>
        <h1 className="text-2xl font-semibold text-[#0F0F0F]">
          {receipt.plainEnglish}
        </h1>
        {receipt.pageUrl && (
          <p className="text-sm text-[#333] break-all">{receipt.pageUrl}</p>
        )}
        <dl className="space-y-3 text-sm text-[#333]">
          {receipt.path && (
            <div>
              <dt className="text-xs text-[#9B9B9B]">File</dt>
              <dd className="font-mono text-xs">{receipt.path}</dd>
            </div>
          )}
          {receipt.prUrl && (
            <div>
              <dt className="text-xs text-[#9B9B9B]">Pull request</dt>
              <dd>
                <a
                  href={receipt.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-700 underline"
                >
                  {receipt.prNumber ? `PR #${receipt.prNumber}` : 'Open PR'}
                </a>
                {receipt.mergeSha ? ` · ${receipt.mergeSha.slice(0, 7)}` : ''}
              </dd>
            </div>
          )}
          {receipt.productionVerifiedAt && (
            <div>
              <dt className="text-xs text-[#9B9B9B]">Verified live</dt>
              <dd>{new Date(receipt.productionVerifiedAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>
        <p className="text-xs text-[#9B9B9B]">
          Shared from SEORANKO. Indexing claims are not included on this page.
        </p>
      </div>
    </main>
  )
}

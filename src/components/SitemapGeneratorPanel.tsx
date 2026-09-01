'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { copyToClipboard, downloadTextFile } from '@/lib/copy-export'
import { FIX_AGENT_DEVELOPER_FALLBACK } from '@/lib/developer-snippet-placements'
import type { SitemapCheck, SitemapFile, SitemapGeneratorResult } from '@/lib/sitemap-generator/types'

function CopyButton({
  label,
  text,
  className = 'text-xs px-2 py-0.5 rounded bg-[#0F0F0F] text-white hover:opacity-90',
}: {
  label: string
  text: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button type="button" onClick={() => void copy()} className={className}>
      {copied ? 'Copied' : label}
    </button>
  )
}

function severityClass(severity: SitemapCheck['severity']): string {
  if (severity === 'error') return 'border-red-200 bg-red-50 text-red-900'
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-blue-100 bg-blue-50 text-blue-900'
}

function SitemapFileBlock({ file }: { file: SitemapFile }) {
  return (
    <div className="border border-[#E5E5E5] rounded-lg overflow-hidden bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[#E5E5E5] bg-[#FAFAFA]">
        <span className="text-sm font-medium">{file.filename}</span>
        <div className="flex gap-2">
          <CopyButton label="Copy" text={file.content} />
          <button
            type="button"
            onClick={() => downloadTextFile(file.filename, file.content)}
            className="text-xs px-2 py-0.5 rounded border border-[#E5E5E5] bg-white hover:bg-[#FAFAFA]"
          >
            Download
          </button>
        </div>
      </div>
      <p className="text-xs text-[#6B6B6B] px-3 py-1">{file.urlCount} URL{file.urlCount !== 1 ? 's' : ''}</p>
      <pre className="text-xs font-mono p-3 overflow-x-auto whitespace-pre-wrap break-all text-[#6B6B6B] max-h-96 overflow-y-auto">
        {file.content}
      </pre>
    </div>
  )
}

function ChecksList({ checks }: { checks: SitemapCheck[] }) {
  if (checks.length === 0) return null
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Sitemap checks</h3>
      {checks.map((c) => (
        <div key={c.id} className={`border rounded-lg p-3 text-sm ${severityClass(c.severity)}`}>
          <div className="font-medium">{c.title}</div>
          <p className="text-xs mt-1 whitespace-pre-wrap opacity-90">{c.detail}</p>
          {c.urls && c.urls.length > 0 && (
            <ul className="mt-2 text-xs font-mono space-y-0.5 max-h-32 overflow-y-auto opacity-80">
              {c.urls.map((u) => (
                <li key={u} className="break-all">
                  {u}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

export function SitemapGeneratorPanel({
  initialDomain,
  highlightUrls,
}: {
  initialDomain?: string
  highlightUrls?: string[]
}) {
  const searchParams = useSearchParams()
  const [domain, setDomain] = useState(initialDomain || searchParams.get('domain') || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SitemapGeneratorResult | null>(null)

  const runGenerate = useCallback(async (forceFresh = false) => {
    const trimmed = domain.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/copilot/sitemap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: trimmed, forceFresh }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Generation failed')
      setResult(json.sitemap as SitemapGeneratorResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [domain])

  useEffect(() => {
    const fromQuery = searchParams.get('domain')
    if (fromQuery && !initialDomain) setDomain(fromQuery)
  }, [searchParams, initialDomain])

  useEffect(() => {
    if (initialDomain && !result && !loading) {
      void runGenerate(false)
    }
  }, [initialDomain, result, loading, runGenerate])

  const primaryFile = useMemo(
    () => result?.files.find((f) => f.filename === 'sitemap.xml') || result?.files[0],
    [result],
  )

  return (
    <div className="space-y-4">
      <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white">
        <h2 className="font-medium mb-1">Generate sitemap</h2>
        <p className="text-sm text-[#6B6B6B] mb-3">
          Builds sitemap.xml from Index Diagnosis crawl data — INDEXABLE URLs only, no invented lastmod or priority.
          Reuses a recent crawl for this domain when available.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="example.com"
            className="flex-1 min-w-[200px] text-sm border border-[#E5E5E5] rounded-lg px-3 py-2"
          />
          <button
            type="button"
            onClick={() => void runGenerate(false)}
            disabled={loading || !domain.trim()}
            className="text-sm px-4 py-2 rounded-lg bg-[#FF6B2C] text-white disabled:opacity-50"
          >
            {loading ? 'Generating…' : 'Generate sitemap'}
          </button>
          <button
            type="button"
            onClick={() => void runGenerate(true)}
            disabled={loading || !domain.trim()}
            className="text-sm px-3 py-2 rounded-lg border border-[#E5E5E5] bg-white disabled:opacity-50"
          >
            Fresh crawl
          </button>
        </div>
        {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
      </div>

      {highlightUrls && highlightUrls.length > 0 && !result && (
        <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 text-sm">
          <p className="font-medium">URLs missing from your current sitemap</p>
          <ul className="mt-2 text-xs font-mono space-y-0.5">
            {highlightUrls.map((u) => (
              <li key={u} className="break-all">
                {u}
              </li>
            ))}
          </ul>
          <p className="text-xs text-[#6B6B6B] mt-2">Generate a full sitemap below to include these and all other indexable pages.</p>
        </div>
      )}

      {result && (
        <>
          <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white text-sm space-y-1">
            <p>
              <span className="font-medium">{result.indexableCount}</span> indexable URL
              {result.indexableCount !== 1 ? 's' : ''} · crawl{' '}
              {result.crawlSource === 'reused' ? 'reused from recent Index Diagnosis' : 'ran fresh'}{' '}
              {result.crawlRanAt && (
                <span className="text-[#6B6B6B]">({new Date(result.crawlRanAt).toLocaleString()})</span>
              )}
            </p>
            <p className="text-xs text-[#6B6B6B]">
              Also available from{' '}
              <Link href="/dashboard/audit" className="text-[#FF6B2C] underline">
                Audit → Index Diagnosis
              </Link>
              .
            </p>
          </div>

          <ChecksList checks={result.checks} />

          {result.robotsTxtSitemapDirective && (
            <div className="border border-amber-200 rounded-xl p-4 bg-amber-50">
              <h3 className="text-sm font-medium mb-1">Add to robots.txt</h3>
              <p className="text-xs text-[#6B6B6B] mb-2">Your robots.txt does not yet reference a sitemap. Add this line:</p>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton label="Copy line" text={result.robotsTxtSitemapDirective} />
                <code className="text-xs font-mono bg-white px-2 py-1 rounded border">{result.robotsTxtSitemapDirective}</code>
              </div>
            </div>
          )}

          <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white space-y-3">
            <h3 className="text-sm font-medium">Sitemap files</h3>
            {result.files.map((f) => (
              <SitemapFileBlock key={f.filename} file={f} />
            ))}
          </div>

          <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white">
            <h3 className="text-sm font-medium mb-2">Where to put this</h3>
            <pre className="text-xs whitespace-pre-wrap text-[#6B6B6B]">{result.placementGuidance}</pre>
            <p className="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mt-3">
              {FIX_AGENT_DEVELOPER_FALLBACK}
            </p>
          </div>

          {primaryFile && (
            <div className="text-xs text-[#9B9B9B]">
              Primary file: {primaryFile.filename} ({primaryFile.urlCount} URLs)
            </div>
          )}
        </>
      )}
    </div>
  )
}

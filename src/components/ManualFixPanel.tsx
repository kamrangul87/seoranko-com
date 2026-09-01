'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ManualFixPayload, ManualFixSnippet } from '@/lib/index-diagnosis/types'
import { developerSnippetsFromFix } from '@/lib/index-diagnosis/manual-fixes'
import { applyPasteAndFix } from '@/lib/manual-paste-fix'
import {
  PLATFORM_LABELS,
  platformRedirectSteps,
  removeDeadLinkGuidance,
  type ManualFixPlatform,
} from '@/lib/manual-fix-platform-steps'
import { copyToClipboard, downloadTextFile, manualFixToText } from '@/lib/copy-export'
import { FIX_AGENT_DEVELOPER_FALLBACK } from '@/lib/developer-snippet-placements'

function CopyButton({
  label,
  getText,
  className = 'text-xs px-2 py-0.5 rounded bg-[#0F0F0F] text-white hover:opacity-90',
}: {
  label: string
  getText: () => string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    const ok = await copyToClipboard(getText())
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

function SnippetBlock({ snippet, showCopy = true }: { snippet: ManualFixSnippet; showCopy?: boolean }) {
  const fullText = [snippet.placementBefore, snippet.content, snippet.placementAfter].filter(Boolean).join('\n\n')

  return (
    <div className="border border-[#E5E5E5] rounded-lg overflow-hidden bg-[#FAFAFA]">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-white border-b border-[#E5E5E5]">
        <span className="text-xs font-medium text-[#0F0F0F]">{snippet.label}</span>
        {showCopy && <CopyButton label="Copy" getText={() => fullText} />}
      </div>
      {snippet.placementBefore && (
        <div className="text-xs text-[#0F0F0F] px-2 py-2 bg-amber-50 border-b border-amber-100 whitespace-pre-wrap">
          {snippet.placementBefore}
        </div>
      )}
      <pre className="text-xs font-mono p-2 overflow-x-auto whitespace-pre-wrap break-all text-[#6B6B6B] max-h-64 overflow-y-auto bg-white">
        {snippet.content}
      </pre>
      {snippet.placementAfter && (
        <div className="text-xs text-[#6B6B6B] px-2 py-2 border-t border-[#E5E5E5] whitespace-pre-wrap">
          {snippet.placementAfter}
        </div>
      )}
    </div>
  )
}

function PasteAndFixSection({ fix }: { fix: ManualFixPayload }) {
  const [html, setHtml] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  if (!fix.contentFixKind) return null

  const placeholder =
    fix.contentFixKind === 'sitemap_entries'
      ? 'Paste your existing sitemap.xml here…'
      : 'Paste your page HTML (or just the <head> section) here…'

  function runFix() {
    setError(null)
    setSummary(null)
    const result = applyPasteAndFix({
      html,
      fixKind: fix.contentFixKind!,
      canonicalUrl: fix.canonicalSelfUrl,
      sitemapEntries: fix.sitemapEntriesRaw,
    })
    if (!result.ok) {
      setOutput(null)
      setError(result.error || 'Could not apply fix.')
      return
    }
    setOutput(result.html)
    setSummary(result.summary)
  }

  return (
    <div className="border border-green-200 rounded-lg p-3 bg-green-50 space-y-2">
      <div className="text-xs font-medium text-[#0F0F0F]">Paste and fix (no coding required)</div>
      <p className="text-xs text-[#6B6B6B]">
        Paste your actual page content below. We return the same content with only the detected issue corrected —
        nothing invented.
      </p>
      <textarea
        value={html}
        onChange={(e) => setHtml(e.target.value)}
        placeholder={placeholder}
        rows={6}
        className="w-full text-xs font-mono border border-[#E5E5E5] rounded-lg p-2 bg-white"
      />
      <button
        type="button"
        onClick={runFix}
        disabled={!html.trim()}
        className="text-xs px-3 py-1.5 rounded-lg bg-green-800 text-white disabled:opacity-50"
      >
        Apply fix to my content
      </button>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {summary && <p className="text-xs text-green-800">{summary}</p>}
      {output && (
        <div className="space-y-1">
          <div className="flex gap-2">
            <CopyButton label="Copy fixed content" getText={() => output} />
          </div>
          <pre className="text-xs font-mono p-2 bg-white border rounded-lg max-h-64 overflow-auto whitespace-pre-wrap break-all">
            {output}
          </pre>
        </div>
      )}
    </div>
  )
}

function PlatformStepsSection({ fix }: { fix: ManualFixPayload }) {
  const [platform, setPlatform] = useState<ManualFixPlatform>('wordpress')

  const platformSteps = useMemo(() => {
    if (!fix.redirectTargets?.length) return []
    const steps: string[] = []
    for (const t of fix.redirectTargets) {
      if (platform === 'developer') continue
      if (fix.fixType === 'non_200') {
        steps.push(
          removeDeadLinkGuidance(platform, t.fromUrl, t.inboundFrom || []),
          '',
          platformRedirectSteps(platform, t),
        )
      } else {
        steps.push(platformRedirectSteps(platform, t))
      }
    }
    return steps.filter(Boolean)
  }, [fix, platform])

  if (fix.fixMode === 'content' && !fix.redirectTargets?.length) return null

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-[#0F0F0F]">How to fix on your platform</div>
      <div className="flex flex-wrap gap-1">
        {(Object.keys(PLATFORM_LABELS) as ManualFixPlatform[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPlatform(p)}
            className={`text-xs px-2 py-1 rounded-lg border ${
              platform === p
                ? 'bg-[#0F0F0F] text-white border-[#0F0F0F]'
                : 'bg-white text-[#6B6B6B] border-[#E5E5E5]'
            }`}
          >
            {PLATFORM_LABELS[p]}
          </button>
        ))}
      </div>

      {platform !== 'developer' && platformSteps.length > 0 && (
        <div className="space-y-2">
          {platformSteps.map((step, i) => (
            <SnippetBlock
              key={`step-${i}`}
              snippet={{ id: `platform-${i}`, label: PLATFORM_LABELS[platform], kind: 'guidance', content: step }}
            />
          ))}
        </div>
      )}

      {platform === 'developer' && (
        <div className="space-y-2">
          <div className="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            {FIX_AGENT_DEVELOPER_FALLBACK}
          </div>
          <p className="text-xs text-[#6B6B6B]">
            Technical snippets below include which file to edit, where to put the code, and what to do after saving.
            Hand this to your developer if you are not comfortable editing config files yourself.
          </p>
          {developerSnippetsFromFix(fix).map((s) => (
            <SnippetBlock key={s.id} snippet={s} />
          ))}
        </div>
      )}
    </div>
  )
}

export function ManualFixPanel({
  fix,
  siteId,
}: {
  fix: ManualFixPayload
  siteId?: string
}) {
  const router = useRouter()
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)

  const exportText = useMemo(
    () =>
      manualFixToText(fix, {
        platform: 'full export',
        platformSteps: fix.redirectTargets?.map((t) => t.evidence) || [],
      }),
    [fix],
  )

  async function openBrief() {
    if (!fix.briefContext) return
    setBriefLoading(true)
    setBriefError(null)
    try {
      const res = await fetch('/api/copilot/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seedKeyword: fix.briefContext.sharedTopic,
          siteId: siteId || undefined,
          indexDiagnosisCohort: fix.briefContext,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not build brief')
      if (json.id) {
        router.push(`/dashboard/briefs?id=${encodeURIComponent(json.id)}`)
        return
      }
      sessionStorage.setItem('seoranko_pending_brief', JSON.stringify(json))
      router.push('/dashboard/briefs?pending=1')
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : 'Could not build brief')
    } finally {
      setBriefLoading(false)
    }
  }

  if (fix.fixType === 'sitemap_gap') {
    const href = `/dashboard/sitemap?domain=${encodeURIComponent(fix.sitemapDomain || '')}`
    return (
      <div className="mt-3 pt-3 border-t border-blue-100 space-y-2">
        <p className="text-xs text-[#6B6B6B]">{fix.evidenceCitation}</p>
        {fix.linkedOnlyHighlight && fix.linkedOnlyHighlight.length > 0 && (
          <ul className="text-xs font-mono text-[#6B6B6B] space-y-0.5 max-h-32 overflow-y-auto">
            {fix.linkedOnlyHighlight.map((u) => (
              <li key={u} className="break-all">
                {u}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-[#0F0F0F]">
          Sitemaps list URLs for crawlers — they do not contain page content. Use the Sitemap Generator to build a
          complete, valid sitemap.xml from your crawl data.
        </p>
        <Link
          href={href}
          className="inline-block text-xs px-3 py-1.5 rounded-lg bg-[#FF6B2C] text-white"
        >
          Open Sitemap Generator
        </Link>
      </div>
    )
  }

  if (fix.fixType === 'duplicate_cohort') {
    return (
      <div className="mt-3 pt-3 border-t border-blue-100 space-y-2">
        <p className="text-xs text-[#6B6B6B]">{fix.evidenceCitation}</p>
        {fix.briefContext && (
          <p className="text-xs text-[#0F0F0F]">
            Shared topic: <span className="font-medium">{fix.briefContext.sharedTopic}</span>
            {fix.briefContext.pageSummaries.length > 0 && (
              <>
                {' '}
                — overlapping pages:{' '}
                {fix.briefContext.pageSummaries
                  .slice(0, 3)
                  .map((p) => p.title || p.slugLabel)
                  .join(', ')}
              </>
            )}
          </p>
        )}
        <p className="text-xs text-[#0F0F0F]">
          Near-duplicate content needs strategist guidance — not auto-generated copy.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void openBrief()}
            disabled={briefLoading}
            className="px-3 py-1.5 rounded-lg bg-[#FF6B2C] text-white text-xs disabled:opacity-50"
          >
            {briefLoading ? 'Building brief…' : 'Open Content Brief for this cohort'}
          </button>
        </div>
        {briefError && <p className="text-xs text-red-700">{briefError}</p>}
      </div>
    )
  }

  return (
    <div className="mt-3 pt-3 border-t border-blue-100 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton label="Copy all" getText={() => exportText} />
        <button
          type="button"
          onClick={() => downloadTextFile(`manual-fix-${fix.fixType}.txt`, exportText)}
          className="text-xs px-2 py-0.5 rounded border border-[#E5E5E5] bg-white hover:bg-[#FAFAFA]"
        >
          Download .txt
        </button>
      </div>

      <p className="text-xs text-[#6B6B6B]">{fix.evidenceCitation}</p>

      {(fix.fixMode === 'content' || fix.fixMode === 'hybrid') && fix.contentFixKind && (
        <PasteAndFixSection fix={fix} />
      )}

      {(fix.fixMode === 'infrastructure' || fix.fixMode === 'hybrid') && fix.redirectTargets && (
        <PlatformStepsSection fix={fix} />
      )}

      {fix.fixMode === 'content' && fix.snippets.length > 0 && !fix.contentFixKind && (
        <div className="space-y-2">
          {fix.snippets.map((s) => (
            <SnippetBlock key={s.id} snippet={s} />
          ))}
        </div>
      )}
    </div>
  )
}

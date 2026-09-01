'use client'

import { useState } from 'react'
import { applyPasteAndFix, pasteFixKindFromAuditIssue } from '@/lib/manual-paste-fix'
import { copyToClipboard } from '@/lib/copy-export'

export function AuditPasteFix({
  issueTitle,
  issueDescription,
}: {
  issueTitle: string
  issueDescription: string
}) {
  const fixKind = pasteFixKindFromAuditIssue(issueTitle, issueDescription)
  const [open, setOpen] = useState(false)
  const [html, setHtml] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  if (!fixKind) return null

  function runFix() {
    setError(null)
    const result = applyPasteAndFix({ html, fixKind: fixKind! })
    if (!result.ok) {
      setOutput(null)
      setError(result.error || 'Could not apply fix.')
      return
    }
    setOutput(result.html)
    setSummary(result.summary)
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-[#FF6B2C] underline"
      >
        {open ? 'Hide paste-and-fix' : 'Paste and fix (no coding)'}
      </button>
      {open && (
        <div className="mt-2 border border-green-200 rounded-lg p-3 bg-green-50 space-y-2">
          <p className="text-xs text-[#6B6B6B]">
            Paste your page HTML below. We return the same content with only this issue corrected — using your
            existing text, trimmed or restructured mechanically.
          </p>
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            placeholder="Paste your page HTML here…"
            rows={5}
            className="w-full text-xs font-mono border border-[#E5E5E5] rounded-lg p-2 bg-white"
          />
          <button
            type="button"
            onClick={runFix}
            disabled={!html.trim()}
            className="text-xs px-3 py-1.5 rounded-lg bg-green-800 text-white disabled:opacity-50"
          >
            Apply fix
          </button>
          {error && <p className="text-xs text-red-700">{error}</p>}
          {summary && <p className="text-xs text-green-800">{summary}</p>}
          {output && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => void copyToClipboard(output)}
                className="text-xs px-2 py-0.5 rounded bg-[#0F0F0F] text-white"
              >
                Copy fixed content
              </button>
              <pre className="text-xs font-mono p-2 bg-white border rounded-lg max-h-48 overflow-auto whitespace-pre-wrap break-all">
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

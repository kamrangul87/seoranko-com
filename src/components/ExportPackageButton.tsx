'use client'
import { useState } from 'react'

// Inline SVG icons (lucide-react not installed)
function IconPackage({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  )
}

function IconLoader({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  )
}

interface Props {
  /** Full article HTML to package. */
  articleHtml: string
  /** Used for the ZIP filename and README title. */
  title?: string
  /** Optional style override for pages that use inline styles rather than Tailwind. */
  style?: React.CSSProperties
  className?: string
}

export function ExportPackageButton({ articleHtml, title, style, className }: Props) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  async function handleExportPackage() {
    setExporting(true)
    setExportError(null)
    try {
      const res = await fetch('/api/export-article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleHtml, title })
      })

      if (!res.ok) {
        // An error response is JSON; a success response is a ZIP.
        let message = 'Export failed'
        try {
          const data = await res.json()
          message = data.error || message
        } catch { /* non-JSON error body */ }
        throw new Error(message)
      }

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(title || 'article').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'article'}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed — try again')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <button
        onClick={handleExportPackage}
        disabled={exporting || !articleHtml}
        style={style}
        className={className ?? 'flex items-center gap-1.5 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors'}
      >
        {exporting
          ? <><IconLoader className="w-3.5 h-3.5 animate-spin" /> Packaging…</>
          : <><IconPackage className="w-3.5 h-3.5" /> Download package (.zip)</>
        }
      </button>
      {exportError && <p className="text-xs text-red-600 mt-2">{exportError}</p>}
    </>
  )
}

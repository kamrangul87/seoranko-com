'use client'

/**
 * Owner form + deterministic privacy-notice preview.
 * Shows "template — not legal advice" in the dashboard only (never on page HTML).
 */

import { useState } from 'react'
import { supabase } from '@/lib/supabase-client'

type Props = {
  siteId: string
  siteDomain: string
}

const EMPTY = {
  controllerName: '',
  controllerAddress: '',
  contactEmail: '',
  jurisdiction: '',
  retentionSummary: '',
  retentionAnalytics: '',
  retentionForms: '',
}

export function PrivacyNoticeAssembler({ siteId, siteDomain }: Props) {
  const [fields, setFields] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasons, setReasons] = useState<string[] | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dashboardNote, setDashboardNote] = useState<string | null>(null)

  async function assemble() {
    setBusy(true)
    setError(null)
    setReasons(null)
    setPreview(null)
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      setError('Sign in required')
      setBusy(false)
      return
    }
    try {
      const res = await fetch('/api/compliance/assemble-privacy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ siteId, fields }),
      })
      const data = await res.json()
      setDashboardNote(data.dashboardNote ?? null)
      if (!data.ok) {
        setReasons(data.reasons ?? ['Assembly refused'])
      } else {
        setPreview(data.mdx ?? data.html ?? '')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-[#E8E8E4] pt-4 mt-4">
      <div>
        <h4 className="text-sm font-semibold text-gray-900">
          Privacy notice assembler — {siteDomain}
        </h4>
        <p className="text-xs text-[#6B6B6B] mt-1">
          Fixed clause library only. Empty required fields refuse assembly — nothing is invented.
        </p>
        {dashboardNote && (
          <p className="text-xs mt-2 text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            {dashboardNote}
          </p>
        )}
        {!dashboardNote && (
          <p className="text-xs mt-2 text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            This is a template assembled from fixed clause library text — not legal advice.
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(
          [
            ['controllerName', 'Controller name'],
            ['controllerAddress', 'Controller address'],
            ['contactEmail', 'Contact email'],
            ['jurisdiction', 'Jurisdiction (e.g. UK, IE)'],
            ['retentionSummary', 'Retention summary'],
            ['retentionAnalytics', 'Analytics retention'],
            ['retentionForms', 'Forms retention'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="text-xs text-[#6B6B6B] block">
            {label}
            <input
              className="mt-1 w-full border border-[#E8E8E4] rounded px-2 py-1 text-sm text-gray-900"
              value={fields[key]}
              onChange={(e) =>
                setFields((f) => ({ ...f, [key]: e.target.value }))
              }
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={assemble}
        className="text-sm px-3 py-1.5 rounded bg-[#0F0F0F] text-white disabled:opacity-50"
      >
        {busy ? 'Assembling…' : 'Assemble privacy notice'}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {reasons && (
        <ul className="text-xs text-red-700 list-disc pl-4">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {preview && (
        <pre className="text-xs whitespace-pre-wrap bg-[#FAFAF8] border border-[#E8E8E4] rounded p-3 max-h-64 overflow-auto">
          {preview}
        </pre>
      )}
    </div>
  )
}

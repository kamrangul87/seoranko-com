'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase-client'
import { getConnectedSites, ConnectedSite } from '@/lib/connected-sites'

// Inline SVG icons (lucide-react not installed)
function IconGlobe({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}
function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

interface SiteSelectorProps {
  selectedDomain: string | null
  onSelect: (domain: string) => void
  /** Also receive the full site record — callers needing the id for site-level fixes. */
  onSelectSite?: (site: ConnectedSite) => void
}

export function SiteSelector({ selectedDomain, onSelect, onSelectSite }: SiteSelectorProps) {
  const [sites, setSites] = useState<ConnectedSite[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { if (!cancelled) setLoading(false); return }

      const result = await getConnectedSites(supabase, session.user.id)
      if (cancelled) return

      setSites(result)
      if (!selectedDomain && result.length > 0) {
        const primary = result.find(s => s.isPrimary) || result[0]
        onSelect(primary.domain)
        onSelectSite?.(primary)
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
    // Intentionally run once — selectedDomain/onSelect would re-trigger the fetch.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Close the dropdown on an outside click
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (loading) {
    return <div className="h-9 w-40 bg-gray-100 rounded-lg animate-pulse" />
  }

  if (sites.length === 0) {
    return (
      <button
        onClick={() => router.push('/dashboard/settings?tab=sites')}
        className="flex items-center gap-2 text-sm text-orange-600 border border-orange-200 bg-orange-50 px-3 py-2 rounded-lg hover:border-orange-300 transition-colors"
      >
        <IconPlus className="w-4 h-4" />
        Connect your site to get started
      </button>
    )
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-medium border border-gray-200 px-3 py-2 rounded-lg hover:border-gray-300 bg-white transition-colors"
      >
        <IconGlobe className="w-4 h-4 text-gray-400" />
        {selectedDomain || 'Select a site'}
        <IconChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[220px]">
          {sites.map(site => (
            <button
              key={site.id}
              onClick={() => { onSelect(site.domain); onSelectSite?.(site); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 hover:bg-gray-50 ${
                selectedDomain === site.domain ? 'text-orange-600 font-medium' : 'text-gray-700'
              }`}
            >
              {site.domain}
              {site.isPrimary && <span className="text-xs text-gray-400">Primary</span>}
            </button>
          ))}
          <button
            onClick={() => router.push('/dashboard/settings?tab=sites')}
            className="w-full text-left px-3 py-2 text-sm text-gray-500 border-t border-gray-100 hover:bg-gray-50 flex items-center gap-1.5"
          >
            <IconPlus className="w-3.5 h-3.5" />
            Add another site
          </button>
        </div>
      )}
    </div>
  )
}

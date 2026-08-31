'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase-client'
import { ConnectSiteModal } from '@/components/ConnectSiteModal'
import {
  getConnectedSites, addConnectedSite, setPrimarySite, removeConnectedSite,
  ConnectedSite
} from '@/lib/connected-sites'

const BRAND_OPTIONS = ['autodun', 'seoranko', 'fitford', 'other']

// Only the non-secret columns — wp_app_password is REVOKEd from the browser
// role at the database level, so selecting it here would error.
interface SiteConnection {
  site_id: string
  cms_type: string
  detected_seo_plugin: string | null
  last_verified_at: string | null
}

// Inline SVG icons (lucide-react not installed)
function IconGlobe({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
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
function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-.867 12.142A2 2 0 0116.138 20H7.862a2 2 0 01-1.995-1.858L5 6m5 0V4a2 2 0 012-2h0a2 2 0 012 2v2" />
    </svg>
  )
}
function IconStar({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

export function SitesManager() {
  const [sites, setSites] = useState<ConnectedSite[]>([])
  const [connections, setConnections] = useState<Record<string, SiteConnection>>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [domain, setDomain] = useState('')
  const [brand, setBrand] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectTarget, setConnectTarget] = useState<{ id: string; domain: string; token?: string | null } | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setLoading(false); return }
    const result = await getConnectedSites(supabase, session.user.id)
    setSites(result)

    const { data: conns } = await supabase
      .from('site_connections')
      .select('site_id, cms_type, detected_seo_plugin, last_verified_at')
      .eq('user_id', session.user.id)
      .eq('is_active', true)

    setConnections(
      Object.fromEntries((conns || []).map((c: SiteConnection) => [c.site_id, c]))
    )
    setLoading(false)
  }

  async function handleAdd() {
    setSaving(true)
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    // The spec's version returned here without clearing `saving`, leaving the
    // button stuck on "Adding…" forever.
    if (!session) {
      setError('Your session expired — please refresh and sign in again.')
      setSaving(false)
      return
    }

    const result = await addConnectedSite(supabase, session.user.id, domain, brand)
    if (!result.success) {
      setError(result.error || 'Failed to add site')
      setSaving(false)
      return
    }

    setDomain('')
    setShowForm(false)
    setSaving(false)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Your Sites</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Connect via GitHub, WordPress, Shopify, Webflow, or Universal Tag so Audit Fix Agent can apply changes on sites you own.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
        >
          <IconPlus className="w-4 h-4" />
          Add site
        </button>
      </div>

      {showForm && (
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
          <input
            type="text"
            placeholder="autodun.com"
            value={domain}
            onChange={e => setDomain(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && domain) handleAdd() }}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400"
          />
          <div className="flex gap-2 flex-wrap">
            {BRAND_OPTIONS.map(b => (
              <button
                key={b}
                onClick={() => setBrand(b)}
                className={`text-xs px-3 py-1.5 rounded-lg border capitalize transition-colors ${
                  brand === b ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {b}
              </button>
            ))}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            onClick={handleAdd}
            disabled={saving || !domain}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
          >
            {saving ? 'Adding…' : 'Add site'}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-6">Loading your sites…</p>
        ) : sites.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl">
            <IconGlobe className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No sites connected yet</p>
            <p className="text-xs text-gray-400 mt-1">Add your domain so RANKO analyses your real site.</p>
          </div>
        ) : sites.map(site => (
          <div key={site.id} className="flex items-center justify-between gap-3 p-3 bg-white border border-gray-200 rounded-lg">
            <div className="flex items-center gap-2 min-w-0">
              <IconGlobe className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="text-sm font-medium text-gray-800 truncate">{site.domain}</span>
              <span className="text-xs text-gray-400 capitalize flex-shrink-0">({site.brand})</span>
              {site.isPrimary && (
                <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0">
                  <IconStar className="w-3 h-3" /> Primary
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <button
                onClick={() => setConnectTarget({ id: site.id, domain: site.domain, token: site.universalTagToken })}
                className={`text-xs transition-colors ${connections[site.id]
                  ? 'text-green-600 hover:text-green-700'
                  : 'text-blue-600 hover:text-blue-700'}`}
              >
                {connections[site.id]
                  ? connections[site.id].cms_type === 'universal-tag'
                    ? '✓ Tag installed · Change connection'
                    : `✓ ${connections[site.id].cms_type} · Change connection`
                  : 'Connect site'}
              </button>
              {!site.isPrimary && (
                <button
                  onClick={async () => {
                    const { data: { session } } = await supabase.auth.getSession()
                    if (session) { await setPrimarySite(supabase, session.user.id, site.id); load() }
                  }}
                  className="text-xs text-gray-400 hover:text-orange-500 transition-colors"
                >
                  Make primary
                </button>
              )}
              <button
                onClick={async () => { await removeConnectedSite(supabase, site.id); load() }}
                className="text-gray-300 hover:text-red-400 transition-colors"
                aria-label={`Remove ${site.domain}`}
              >
                <IconTrash className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {connectTarget && (
        <ConnectSiteModal
          siteId={connectTarget.id}
          domain={connectTarget.domain}
          universalTagToken={connectTarget.token}
          currentCmsType={connections[connectTarget.id]?.cms_type || null}
          onClose={() => setConnectTarget(null)}
          onConnected={load}
        />
      )}
    </div>
  )
}

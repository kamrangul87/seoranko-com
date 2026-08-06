'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase-client'

interface RegistryLink {
  id: string
  brand: string
  site_url: string
  page_url: string
  page_title: string
  page_description: string | null
  topic_tags: string[]
  anchor_text: string
  is_active: boolean
}

const BRAND_OPTIONS = [
  { value: 'autodun', label: '🚗 Autodun', color: '#FF6B2C' },
  { value: 'seoranko', label: '📊 SEORANKO', color: '#6366F1' },
  { value: 'fitford', label: '💪 FitFord', color: '#10B981' },
]

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <line x1="12" y1="5" x2="12" y2="19" strokeWidth={2} strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

function IconLink({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  )
}

function IconTag({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
    </svg>
  )
}

function IconInfo({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16v-4M12 8h.01" />
    </svg>
  )
}

export function LinkRegistryManager() {
  const [links, setLinks] = useState<RegistryLink[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filterBrand, setFilterBrand] = useState<string>('all')
  const [form, setForm] = useState({
    brand: '',
    site_url: '',
    page_url: '',
    page_title: '',
    page_description: '',
    topic_tags: '',
    anchor_text: ''
  })


  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('internal_link_registry')
      .select('*')
      .eq('is_active', true)
      .order('brand', { ascending: true })
      .order('created_at', { ascending: false })
    setLinks(data || [])
    setLoading(false)
  }

  async function saveLink() {
    if (!form.page_url || !form.page_title || !form.anchor_text || !form.brand) return
    setSaving(true)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { setSaving(false); return }

    const tags = form.topic_tags
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)

    let siteUrl = form.site_url
    if (!siteUrl) {
      try { siteUrl = new URL(form.page_url).origin } catch { siteUrl = '' }
    }

    const { error } = await supabase
      .from('internal_link_registry')
      .insert({
        user_id: session.user.id,
        brand: form.brand,
        site_url: siteUrl,
        page_url: form.page_url,
        page_title: form.page_title,
        page_description: form.page_description || null,
        topic_tags: tags,
        anchor_text: form.anchor_text,
        is_active: true
      })

    if (!error) {
      setForm({ brand: '', site_url: '', page_url: '', page_title: '', page_description: '', topic_tags: '', anchor_text: '' })
      setShowForm(false)
      load()
    }
    setSaving(false)
  }

  async function deleteLink(id: string) {
    await supabase.from('internal_link_registry').update({ is_active: false }).eq('id', id)
    load()
  }

  const filtered = filterBrand === 'all' ? links : links.filter(l => l.brand === filterBrand)
  const brandColor = (brand: string) => BRAND_OPTIONS.find(b => b.value === brand)?.color || '#6B7280'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Internal Link Registry</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Links here are the ONLY ones SEORANKO will place in articles. Brand-matched only.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 px-3 py-1.5 rounded-lg transition-colors"
        >
          <IconPlus className="w-4 h-4" />
          Add link
        </button>
      </div>

      {/* How it works */}
      <div className="flex gap-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
        <IconInfo className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-blue-700 leading-relaxed space-y-1">
          <p><strong>How brand-safe linking works:</strong></p>
          <p>Autodun articles → only Autodun links from this registry are eligible.</p>
          <p>SEORANKO articles → only SEORANKO links are eligible.</p>
          <p>Topic tags add a second filter: a link is only placed if its tags overlap with the article keyword.</p>
          <p><strong>SEORANKO.com will never appear in an EV charger article.</strong></p>
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
          <p className="text-sm font-semibold text-gray-700">Add link to registry</p>

          <div>
            <label className="text-xs text-gray-500 mb-1 block font-medium">Brand — this link belongs to:</label>
            <div className="flex gap-2 flex-wrap">
              {BRAND_OPTIONS.map(b => (
                <button
                  key={b.value}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, brand: b.value }))}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium ${
                    form.brand === b.value
                      ? 'border-orange-400 bg-orange-50 text-orange-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Page URL</label>
            <input
              type="url"
              placeholder="https://autodun.com/mot-checker"
              value={form.page_url}
              onChange={e => setForm(f => ({ ...f, page_url: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Page title</label>
            <input
              type="text"
              placeholder="Free MOT Checker — Check Your MOT Due Date"
              value={form.page_title}
              onChange={e => setForm(f => ({ ...f, page_title: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Preferred anchor text</label>
            <input
              type="text"
              placeholder="check your MOT due date"
              value={form.anchor_text}
              onChange={e => setForm(f => ({ ...f, anchor_text: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">
              Topic tags <span className="text-gray-400">(comma separated — used to match article topics)</span>
            </label>
            <input
              type="text"
              placeholder="mot, vehicle, car, uk, road tax, annual check"
              value={form.topic_tags}
              onChange={e => setForm(f => ({ ...f, topic_tags: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">
              Page description <span className="text-gray-400">(optional — helps topic matching)</span>
            </label>
            <input
              type="text"
              placeholder="Check when your vehicle's MOT is due — free tool"
              value={form.page_description}
              onChange={e => setForm(f => ({ ...f, page_description: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={saveLink}
              disabled={saving || !form.page_url || !form.page_title || !form.anchor_text}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save to registry'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Brand filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterBrand('all')}
          className={`text-xs px-3 py-1 rounded-full border font-medium ${filterBrand === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-500'}`}
        >
          All ({links.length})
        </button>
        {BRAND_OPTIONS.map(b => {
          const count = links.filter(l => l.brand === b.value).length
          if (count === 0) return null
          return (
            <button
              key={b.value}
              onClick={() => setFilterBrand(b.value)}
              className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${filterBrand === b.value ? 'text-white border-transparent' : 'border-gray-200 text-gray-500'}`}
              style={filterBrand === b.value ? { background: brandColor(b.value) } : {}}
            >
              {b.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Link list */}
      {loading ? (
        <p className="text-sm text-gray-400 text-center py-6">Loading registry...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-xl">
          <IconLink className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No links in registry yet</p>
          <p className="text-xs text-gray-400 mt-1">Add your first link to enable brand-safe internal linking</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(link => (
            <div key={link.id} className="flex items-start gap-3 p-3 bg-white rounded-lg border border-gray-200">
              <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: brandColor(link.brand) }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-medium text-gray-800 truncate">{link.page_title}</p>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                    style={{ background: brandColor(link.brand) + '20', color: brandColor(link.brand) }}
                  >
                    {link.brand}
                  </span>
                </div>
                <p className="text-xs text-gray-400 truncate">{link.page_url}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-blue-600">Anchor: &ldquo;{link.anchor_text}&rdquo;</span>
                  {link.topic_tags.length > 0 && (
                    <div className="flex items-center gap-1">
                      <IconTag className="w-3 h-3 text-gray-400" />
                      <span className="text-xs text-gray-400">
                        {link.topic_tags.slice(0, 4).join(', ')}
                        {link.topic_tags.length > 4 && ` +${link.topic_tags.length - 4}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => deleteLink(link.id)}
                className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                aria-label="Remove link"
              >
                <IconTrash className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

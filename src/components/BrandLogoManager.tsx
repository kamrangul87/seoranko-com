'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase-client'
import { BRAND_OPTIONS } from '@/lib/brands'

interface BrandLogoRow {
  brand: string
  logo_url: string | null
}

export function BrandLogoManager() {
  const [rows, setRows] = useState<BrandLogoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedBrand, setSelectedBrand] = useState(BRAND_OPTIONS[0].value)
  const [logoUrlInput, setLogoUrlInput] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const existing = rows.find(r => r.brand === selectedBrand)
    setLogoUrlInput(existing?.logo_url || '')
    setSaved(false)
  }, [selectedBrand, rows])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('brand_settings').select('brand, logo_url')
    setRows(data || [])
    setLoading(false)
  }

  async function saveLogo() {
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { setSaving(false); return }

    const { error } = await supabase
      .from('brand_settings')
      .upsert(
        {
          user_id: session.user.id,
          brand: selectedBrand,
          logo_url: logoUrlInput.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,brand' }
      )

    if (!error) {
      setSaved(true)
      load()
    }
    setSaving(false)
  }

  const logoFor = (brand: string) => rows.find(r => r.brand === brand)?.logo_url || null

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Brand Logo</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Used in each brand&rsquo;s article schema (Organization/publisher logo) — Google&rsquo;s
          structured data guidelines list this as a recommended property for full Article
          rich-result eligibility. Optional; articles publish fine without one.
        </p>
      </div>

      <div>
        <label className="text-xs text-gray-500 mb-1 block font-medium">Brand</label>
        <div className="flex gap-2 flex-wrap">
          {BRAND_OPTIONS.map(b => (
            <button
              key={b.value}
              type="button"
              onClick={() => setSelectedBrand(b.value)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium ${
                selectedBrand === b.value
                  ? 'border-orange-400 bg-orange-50 text-orange-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {b.label}
              {logoFor(b.value) && <span className="ml-1 text-green-600">✓</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Logo URL</label>
            <input
              type="url"
              placeholder="https://autodun.com/logo.png"
              value={logoUrlInput}
              onChange={e => { setLogoUrlInput(e.target.value); setSaved(false) }}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400"
            />
          </div>

          {logoUrlInput && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrlInput}
              alt={`${selectedBrand} logo preview`}
              className="h-10 max-w-[160px] object-contain rounded border border-gray-200 bg-white p-1"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={saveLogo}
              disabled={saving}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            {saved && <span className="text-xs text-green-600">Saved</span>}
          </div>
        </div>
      )}
    </div>
  )
}

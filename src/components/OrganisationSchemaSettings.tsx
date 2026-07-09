'use client'
import { useState } from 'react'

interface OrgSettings {
  org_name: string
  org_url: string
  org_description: string
  org_linkedin: string
  org_twitter: string
  org_github: string
  org_address_country: string
  org_founding_year: string
}

interface OrganisationSchemaSettingsProps {
  initial: Partial<OrgSettings>
  onSave: (data: OrgSettings) => Promise<void>
}

export function OrganisationSchemaSettings({ initial, onSave }: OrganisationSchemaSettingsProps) {
  const [data, setData] = useState<OrgSettings>({
    org_name: initial.org_name || '',
    org_url: initial.org_url || '',
    org_description: initial.org_description || '',
    org_linkedin: initial.org_linkedin || '',
    org_twitter: initial.org_twitter || '',
    org_github: initial.org_github || '',
    org_address_country: initial.org_address_country || 'GB',
    org_founding_year: initial.org_founding_year || ''
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const update = (field: keyof OrgSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setData(prev => ({ ...prev, [field]: e.target.value }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    await onSave(data)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
        <h3 className="text-base font-semibold text-gray-900">Publisher / Organisation</h3>
      </div>

      <div className="flex gap-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
        <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-blue-700 leading-relaxed">
          Fill this in once. SEORANKO adds Organisation schema + sameAs links to every article you generate.
          This is one of the most important signals for AI engines (ChatGPT, Perplexity, Gemini) to verify
          and cite your brand. Social profiles go in sameAs below.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Organisation / Brand name</label>
          <input type="text" value={data.org_name} onChange={update('org_name')}
            placeholder="Autodun"
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Website URL</label>
          <input type="url" value={data.org_url} onChange={update('org_url')}
            placeholder="https://autodun.com"
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Short description (1-2 sentences)</label>
          <textarea value={data.org_description} onChange={update('org_description')}
            placeholder="Autodun is a UK vehicle intelligence platform helping drivers check MOT status, find EV chargers, and decode warning lights."
            rows={2}
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400 resize-none" />
        </div>

        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-600 mb-2">sameAs profiles — paste full URLs</p>
          <p className="text-xs text-gray-400 mb-3">These tell AI engines this is the same organisation across the web. Add as many as you have.</p>

          <div className="space-y-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">LinkedIn company page</label>
              <input type="url" value={data.org_linkedin} onChange={update('org_linkedin')}
                placeholder="https://www.linkedin.com/company/autodun"
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Twitter / X profile</label>
              <input type="url" value={data.org_twitter} onChange={update('org_twitter')}
                placeholder="https://x.com/autodun"
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">GitHub profile or organisation</label>
              <input type="url" value={data.org_github} onChange={update('org_github')}
                placeholder="https://github.com/kamrangul87"
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Country code</label>
            <input type="text" value={data.org_address_country} onChange={update('org_address_country')}
              placeholder="GB"
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Founded year</label>
            <input type="number" value={data.org_founding_year} onChange={update('org_founding_year')}
              placeholder="2024"
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving...' : saved ? 'Saved' : 'Save organisation settings'}
      </button>
    </div>
  )
}

'use client'
import { useState, useEffect } from 'react'
import { DashboardNav } from '@/components/DashboardNav'
import { OrganisationSchemaSettings } from '@/components/OrganisationSchemaSettings'
import { InternalLinksPanel } from '@/components/InternalLinksPanel'
import { LinkRegistryManager } from '@/components/LinkRegistryManager'
import { BrandLogoManager } from '@/components/BrandLogoManager'
import { SitesManager } from '@/components/SitesManager'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { InternalLink } from '@/lib/article-master'

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

export default function SettingsPage() {
  const [orgInitial, setOrgInitial] = useState<Partial<OrgSettings>>({})
  const [internalLinks, setInternalLinks] = useState<InternalLink[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }: { data: { user: User | null } }) => {
      if (!user) { setLoading(false); return }
      setUserId(user.id)
      const { data } = await supabase.from('user_profiles').select('*').eq('id', user.id).single()
      if (data) {
        setOrgInitial({
          org_name: data.org_name || '',
          org_url: data.org_url || data.website_url || '',
          org_description: data.org_description || '',
          org_linkedin: data.org_linkedin || '',
          org_twitter: data.org_twitter || '',
          org_github: data.org_github || '',
          org_address_country: data.org_address_country || 'GB',
          org_founding_year: data.org_founding_year ? String(data.org_founding_year) : '',
        })
        if (data.internal_links) {
          try {
            setInternalLinks(JSON.parse(data.internal_links))
          } catch { /* ignore parse errors */ }
        }
      }
      setLoading(false)
    })
  }, [])

  async function handleSaveOrg(data: OrgSettings) {
    if (!userId) return
    const supabase = createClient()
    await supabase.from('user_profiles').update({
      org_name: data.org_name,
      org_url: data.org_url,
      org_description: data.org_description,
      org_linkedin: data.org_linkedin,
      org_twitter: data.org_twitter,
      org_github: data.org_github,
      org_address_country: data.org_address_country,
      org_founding_year: data.org_founding_year ? parseInt(data.org_founding_year) : null,
    }).eq('id', userId)
  }

  async function handleLinksChange(links: InternalLink[]) {
    setInternalLinks(links)
    if (!userId) return
    const supabase = createClient()
    await supabase.from('user_profiles').update({
      internal_links: JSON.stringify(links),
    }).eq('id', userId)
  }

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold mb-1">Settings</h1>
            <p className="text-[#6B6B6B] text-sm">Configure your organisation schema, internal links, and brand settings.</p>
          </div>

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 bg-white border border-[#E8E8E4] rounded-[10px] animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Connected sites — every diagnostic tool runs against these */}
              <div id="sites" className="bg-white border border-[#E8E8E4] rounded-[10px] p-6">
                <SitesManager />
              </div>
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6">
                <OrganisationSchemaSettings initial={orgInitial} onSave={handleSaveOrg} />
              </div>
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6">
                <InternalLinksPanel links={internalLinks} onChange={handleLinksChange} />
              </div>
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6">
                <LinkRegistryManager />
              </div>
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6">
                <BrandLogoManager />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

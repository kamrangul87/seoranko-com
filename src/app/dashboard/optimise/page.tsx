'use client'
import { useState, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { HubTabs } from '@/components/HubTabs'
import { DashboardNav } from '@/components/DashboardNav'
import { HumanizePanel } from '@/components/HumanizePanel'

const ImproveTab = dynamic(() => import('../improve/page'), { ssr: false })
const NLPTab     = dynamic(() => import('../nlp/page'),     { ssr: false })

const TABS = [
  { id: 'humanize', label: 'Make it human', icon: '✍️' },
  { id: 'improve',  label: 'Boost scores',  icon: '⚡' },
  { id: 'nlp',      label: 'NLP analysis',  icon: '🧠' },
  { id: 'images',   label: 'Images',        icon: '🖼️' },
]

function ImagesPlaceholder() {
  const [topic, setTopic]     = useState('')
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [images, setImages]   = useState<Array<{ url: string; alt: string }>>([])
  const [error, setError]     = useState('')

  async function generate() {
    if (!topic.trim()) return
    setLoading(true)
    setError('')
    setImages([])
    try {
      const res = await fetch('/api/article-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim(), keyword: keyword.trim(), tier: 'free', count: 3 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Image generation failed')
      const imgs = data.images || []
      setImages(imgs.map((img: { url?: string; altText?: string; alt?: string }) => ({ url: img.url || '', alt: img.altText || img.alt || '' })))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Image generation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Images</h1>
        <p className="text-[#6B6B6B] text-sm">Generate SEO-optimised images for your articles.</p>
      </div>

      <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6 mb-6">
        <div className="grid grid-cols-1 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">Article Topic or Description</label>
            <textarea
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="Describe the article content for image generation…"
              className="w-full h-24 px-3 py-2.5 text-sm border border-[#E8E8E4] rounded-[8px] outline-none focus:border-[#FF6B2C]/50 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">Primary Keyword (optional)</label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="e.g. best EV chargers UK"
              className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-4 py-2.5 text-sm focus:outline-none focus:border-[#FF6B2C]/50"
            />
          </div>
        </div>

        <button
          onClick={generate}
          disabled={loading || !topic.trim()}
          className="bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-50 text-[#0a0a0a] font-semibold text-sm px-6 py-2.5 rounded-[8px] transition-colors flex items-center gap-2"
        >
          {loading && (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {loading ? 'Generating images…' : '🖼️ Generate Images'}
        </button>

        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {images.map((img, i) => (
            <div key={i} className="bg-white border border-[#E8E8E4] rounded-[10px] overflow-hidden">
              {img.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img.url} alt={img.alt} className="w-full h-48 object-cover" />
              )}
              <div className="p-3">
                <p className="text-xs text-[#6B6B6B] leading-relaxed">{img.alt}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function OptimisePage() {
  const [activeTab, setActiveTab] = useState('humanize')

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 pt-6 bg-white border-b border-[#E8E8E4] sticky top-0 z-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] mb-3">Optimise</h2>
          <HubTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {activeTab === 'humanize' && <HumanizePanel />}
        {activeTab === 'improve' && (
          <Suspense fallback={<div className="p-8 text-[#6B6B6B]">Loading…</div>}>
            <div className="px-8 py-8">
              <ImproveTab />
            </div>
          </Suspense>
        )}
        {activeTab === 'nlp' && (
          <div style={{ overflow: 'hidden', width: '100%' }}>
            <div style={{ marginLeft: '-224px', display: 'flex', width: 'calc(100% + 224px)' }}>
              <Suspense fallback={<div className="p-8 text-[#6B6B6B]">Loading…</div>}>
                <NLPTab />
              </Suspense>
            </div>
          </div>
        )}
        {activeTab === 'images' && <ImagesPlaceholder />}
      </main>
    </div>
  )
}

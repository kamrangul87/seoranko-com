'use client'
import { useState } from 'react'
import type { InternalLink } from '@/lib/article-master'

export type { InternalLink }

interface InternalLinksPanelProps {
  links: InternalLink[]
  onChange: (links: InternalLink[]) => void
}

export function InternalLinksPanel({ links, onChange }: InternalLinksPanelProps) {
  const [open, setOpen] = useState(false)

  const addLink = () => {
    onChange([...links, { url: '', anchorText: '', context: '' }])
    setOpen(true)
  }

  const removeLink = (index: number) => {
    onChange(links.filter((_, i) => i !== index))
  }

  const updateLink = (index: number, field: keyof InternalLink, value: string) => {
    const updated = links.map((link, i) =>
      i === index ? { ...link, [field]: value } : link
    )
    onChange(updated)
  }

  const validLinks = links.filter(l => l.url && l.anchorText)

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span className="text-sm font-medium text-gray-700">
            Internal Links
          </span>
          {validLinks.length > 0 && (
            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
              {validLinks.length} added
            </span>
          )}
          <span className="text-xs text-gray-400 font-normal">optional</span>
        </div>
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={open ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
        </svg>
      </button>

      {open && (
        <div className="p-4 space-y-4 bg-white">
          <div className="flex gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
            <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="space-y-1">
              <p className="text-xs text-amber-800 font-medium">
                Only add links relevant to this article&apos;s topic
              </p>
              <p className="text-xs text-amber-700 leading-relaxed">
                SEORANKO checks every link for relevance before placing it.
                A link to your SEO tool will not be placed in an EV charging article.
                The &quot;what is this page about&quot; field helps the AI judge relevance accurately.
              </p>
            </div>
          </div>

          {links.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-2">
              No internal links added yet.
            </p>
          )}

          {links.map((link, index) => (
            <div
              key={index}
              className="grid grid-cols-1 gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200 relative"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-500">
                  Link {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeLink(index)}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Page URL</label>
                <input
                  type="url"
                  placeholder="https://yoursite.com/your-page"
                  value={link.url}
                  onChange={(e) => updateLink(index, 'url', e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400 bg-white"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Anchor text (what the link should say)</label>
                <input
                  type="text"
                  placeholder="e.g. MOT predictor tool"
                  value={link.anchorText}
                  onChange={(e) => updateLink(index, 'anchorText', e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400 bg-white"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">What is this page about? <span className="text-amber-600">(important — used to check relevance)</span></label>
                <input
                  type="text"
                  placeholder="e.g. free MOT due date checker for UK cars"
                  value={link.context}
                  onChange={(e) => updateLink(index, 'context', e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400 bg-white"
                />
              </div>
            </div>
          ))}

          {links.length < 5 && (
            <button
              type="button"
              onClick={addLink}
              className="flex items-center gap-1.5 text-sm text-orange-600 hover:text-orange-700 font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add internal link
            </button>
          )}

          {links.length >= 5 && (
            <p className="text-xs text-amber-600">
              Maximum 5 internal links — more than this hurts readability and SEO.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

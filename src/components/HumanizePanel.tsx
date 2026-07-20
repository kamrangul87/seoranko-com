'use client'
import { useState } from 'react'

interface HumanizeResult {
  humanizedHtml: string
  humanScore: number
  passesDetection: boolean
  seoPreserved: {
    linksPreserved: boolean
    keywordInFirstParagraph: boolean
    statsPreserved: boolean
    schemaPreserved: boolean
  }
  bannedWordsRemoved: string[]
}

export function HumanizePanel() {
  const [input, setInput]     = useState('')
  const [keyword, setKeyword] = useState('')
  const [level, setLevel]     = useState<'light' | 'medium' | 'aggressive'>('medium')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [result, setResult]   = useState<HumanizeResult | null>(null)
  const [copied, setCopied]   = useState(false)

  async function handleHumanize() {
    if (!input.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: input.trim(), keyword: keyword.trim(), level }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Humanization failed')
      setResult(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Humanization failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Humanize Article</h1>
        <p className="text-[#6B6B6B] text-sm">Remove AI patterns and score for human detection. Preserves all SEO signals.</p>
      </div>

      <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6 mb-6">
        <div className="flex items-start gap-4 mb-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">Humanization Level</label>
            <div className="flex gap-2">
              {(['light', 'medium', 'aggressive'] as const).map(lvl => (
                <button
                  key={lvl}
                  onClick={() => setLevel(lvl)}
                  className={`px-3 py-1.5 rounded-[6px] text-xs font-semibold capitalize transition-colors ${
                    level === lvl
                      ? 'bg-[#7C3AED] text-white'
                      : 'bg-[#F5F4F1] text-[#374151] hover:bg-[#E8E8E4]'
                  }`}
                >
                  {lvl === 'light' ? '⚡ Light' : lvl === 'medium' ? '🔧 Medium' : '🔥 Aggressive'}
                </button>
              ))}
            </div>
          </div>
          <div className="w-48">
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">Primary Keyword</label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="optional"
              className="w-full px-3 py-1.5 text-sm border border-[#E8E8E4] rounded-[6px] outline-none focus:border-[#7C3AED]"
            />
          </div>
        </div>

        <label className="block text-xs font-semibold text-[#374151] mb-1.5">Article HTML</label>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Paste HTML article here…"
          className="w-full h-48 px-3 py-2.5 text-sm border border-[#E8E8E4] rounded-[8px] outline-none focus:border-[#7C3AED] resize-none font-mono"
        />

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleHumanize}
            disabled={loading || !input.trim()}
            className="bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold text-sm px-6 py-2.5 rounded-[8px] transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {loading
              ? level === 'light' ? 'Lightly humanizing…' : level === 'medium' ? 'Humanizing…' : 'Deep rewriting…'
              : '✍️ Humanize Article'}
          </button>
        </div>
        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
      </div>

      {loading && (
        <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-8 text-center">
          <div className="text-3xl mb-4">✍️</div>
          <p className="text-[#6B6B6B] text-sm mb-1">
            {level === 'light' ? 'Quick humanization pass…' : level === 'medium' ? 'Rewriting with Claude…' : 'Deep rewriting for maximum humanization…'}
          </p>
          <div className="flex gap-2 justify-center mt-4 text-xs text-[#9B9B9B] flex-wrap">
            {['Removing AI phrases', 'Extracting SEO signals', 'Rewriting', 'Re-injecting SEO', 'Scoring'].map(s => (
              <span key={s}>{s}</span>
            ))}
          </div>
        </div>
      )}

      {result && !loading && (
        <div className="space-y-5">
          {/* Score cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4 text-center">
              <div className={`text-3xl font-black ${result.humanScore >= 72 ? 'text-[#7C3AED]' : result.humanScore >= 50 ? 'text-[#F59E0B]' : 'text-[#ef4444]'}`}>
                {result.humanScore}
              </div>
              <div className="text-xs text-[#6B6B6B] mt-1">Human Score /100</div>
            </div>
            <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4 text-center">
              <div className={`text-2xl font-bold ${result.passesDetection ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                {result.passesDetection ? 'Yes' : 'No'}
              </div>
              <div className="text-xs text-[#6B6B6B] mt-1">Passes AI Detection</div>
            </div>
            <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4 text-center">
              <div className="text-2xl font-bold text-[#0F0F0F]">{result.bannedWordsRemoved.length}</div>
              <div className="text-xs text-[#6B6B6B] mt-1">AI Phrases Found</div>
            </div>
            <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4 text-center">
              <div className="text-2xl font-bold text-[#0F0F0F]">
                {[result.seoPreserved.linksPreserved, result.seoPreserved.keywordInFirstParagraph, result.seoPreserved.statsPreserved, result.seoPreserved.schemaPreserved].filter(Boolean).length}/4
              </div>
              <div className="text-xs text-[#6B6B6B] mt-1">SEO Signals Preserved</div>
            </div>
          </div>

          {/* SEO checklist + banned words */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4">
              <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide mb-3">SEO Preservation</p>
              <div className="space-y-2">
                {[
                  { label: 'Links preserved',              ok: result.seoPreserved.linksPreserved },
                  { label: 'Keyword in first paragraph',   ok: result.seoPreserved.keywordInFirstParagraph },
                  { label: 'Stats & numbers preserved',    ok: result.seoPreserved.statsPreserved },
                  { label: 'Schema markup preserved',      ok: result.seoPreserved.schemaPreserved },
                ].map(({ label, ok }) => (
                  <div key={label} className="flex items-center gap-2 text-sm">
                    <span className={ok ? 'text-[#22c55e]' : 'text-[#ef4444]'}>{ok ? '✅' : '⚠️'}</span>
                    <span className={ok ? 'text-[#0F0F0F]' : 'text-[#6B6B6B]'}>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {result.bannedWordsRemoved.length > 0 && (
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4">
                <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide mb-3">AI Phrases Detected</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.bannedWordsRemoved.map(word => (
                    <span key={word} className="bg-[#FEE2E2] text-[#DC2626] text-xs px-2 py-0.5 rounded-[4px] font-medium">
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Humanized article output */}
          <div className="bg-white border border-[#E8E8E4] rounded-[10px] overflow-hidden">
            <div className="px-5 py-3 border-b border-[#E8E8E4] flex items-center justify-between">
              <p className="text-xs font-semibold text-[#374151] uppercase tracking-wide">Humanized Article</p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(result.humanizedHtml).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }).catch(() => {})
                }}
                className="flex items-center gap-1.5 text-xs text-[#6B6B6B] hover:text-[#FF6B2C] transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {copied ? 'Copied!' : 'Copy HTML'}
              </button>
            </div>
            <div
              className="prose prose-sm max-w-none p-6"
              style={{ fontFamily: "'Outfit', sans-serif" }}
              dangerouslySetInnerHTML={{ __html: result.humanizedHtml }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { QualityGatePanel } from '@/components/QualityGatePanel'
import { ExportPackageButton } from '@/components/ExportPackageButton'
import type { ArticleOutput, Tone, Country } from '@/types'
import type { RecurringIssueAlert } from '@/lib/recurring-issue-detector'

const ALL_COUNTRIES: { value: Country; label: string }[] = [
  { value: 'Global', label: 'Global' },
  { value: 'US',     label: 'United States' },
  { value: 'UK',     label: 'United Kingdom' },
  { value: 'AU',     label: 'Australia' },
  { value: 'CA',     label: 'Canada' },
  { value: 'IN',     label: 'India' },
  { value: 'AE',     label: 'UAE' },
  { value: 'SA',     label: 'Saudi Arabia' },
  { value: 'SG',     label: 'Singapore' },
  { value: 'DE',     label: 'Germany' },
  { value: 'FR',     label: 'France' },
  { value: 'ZA',     label: 'South Africa' },
  { value: 'PK',     label: 'Pakistan' },
]

function ScoreRing({ score, label, color, raw }: { score: number; label: string; color: string; raw?: boolean }) {
  // Some upstream scores occasionally arrive on a 0-10 scale instead of
  // 0-100; this heuristic rescales those. Scores that are already a proper
  // 0-100 value (raw: true) must skip it — applying it to keyword density's
  // score, for example, turned a legitimately low 7/100 into a false 70/100.
  const displayScore = !raw && score < 15 ? score * 10 : score
  const r = 28
  const circ = 2 * Math.PI * r
  const offset = circ - (displayScore / 100) * circ
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-16 h-16">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={r} fill="none" stroke="#e5e7eb" strokeWidth="5" />
          <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs font-bold text-[#0F0F0F] leading-none">{displayScore}</span>
          <span className="text-[8px] text-[#6B6B6B] leading-none">/100</span>
        </span>
      </div>
      <span className="text-[10px] text-[#6B6B6B] text-center leading-tight">{label}</span>
    </div>
  )
}

export function ArticleWriter() {
  const searchParams = useSearchParams()
  const [keyword, setKeyword]       = useState('')
  const [country, setCountry]       = useState<Country>('UK')
  const [tone, setTone]             = useState<Tone>('professional')
  const [wordCount, setWordCount]   = useState(2000)
  const [brand, setBrand]           = useState('autodun')
  const [loading, setLoading]       = useState(false)

  // §10 item 16 — NLP moves from a standalone Optimise tab to a Station-3
  // Brief input. Its output was already being written to localStorage
  // ('nlp_brief_data') but nothing ever read it — article-v2 has accepted
  // `entities`/`topicalGaps` as generation inputs all along, they were just
  // hardcoded to [] below. This is what actually makes NLP a brief input
  // rather than a dead-end analysis tool.
  const [nlpBrief, setNlpBrief] = useState<{ entities: string[]; topicalGaps: string[] } | null>(null)

  // Station 2 (Plan) — when the Keywords screen clusters 2+ selected
  // keywords into one page brief, it stores the result here before routing
  // to Write. Previously this had no consumer, so Write always sent
  // secondaryKeywords: [keyword] (the primary keyword duplicated as its own
  // "secondary" — a no-op) regardless of what was selected.
  const [clusterBrief, setClusterBrief] = useState<{ secondaryKeywords: string[]; longTailKeywords: string[]; pageId: string | null } | null>(null)

  useEffect(() => {
    const kw = searchParams.get('keyword')

    const stored = localStorage.getItem('nlp_brief_data')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setNlpBrief({ entities: parsed.entities ?? [], topicalGaps: parsed.topicalGaps ?? [] })
        if (!kw && parsed.recommendedH1) setKeyword(parsed.recommendedH1)
      } catch { /* malformed — ignore, don't block generation */ }
      // Consumed — don't silently reapply to an unrelated later generation.
      localStorage.removeItem('nlp_brief_data')
    }

    const storedCluster = localStorage.getItem('cluster_brief_data')
    if (storedCluster) {
      try {
        const parsed = JSON.parse(storedCluster)
        setClusterBrief({
          secondaryKeywords: parsed.secondaryKeywords ?? [],
          longTailKeywords: parsed.longTailKeywords ?? [],
          pageId: parsed.pageId ?? null,
        })
        if (!kw && parsed.primaryKeyword) setKeyword(parsed.primaryKeyword)
      } catch { /* malformed — ignore, don't block generation */ }
      localStorage.removeItem('cluster_brief_data')
    }

    if (kw) setKeyword(kw)
  }, [searchParams])
  const [error, setError]           = useState('')
  const [article, setArticle]       = useState<ArticleOutput | null>(null)
  const [copied, setCopied]         = useState(false)
  const [progressLabel, setProgressLabel] = useState('')
  const [recurringAlerts, setRecurringAlerts] = useState<RecurringIssueAlert[]>([])

  // Fix 5 (recurring-issue tracker) — after a generation completes, check
  // whether any Quality Gate issue category has shown up in 3+ of the last 5
  // articles. That pattern means the generation prompt itself needs fixing,
  // not that this one article had a fluke.
  useEffect(() => {
    if (!article) return
    fetch('/api/quality-gate/recurring-check')
      .then(r => r.json())
      .then(data => setRecurringAlerts(data.alerts || []))
      .catch(() => {})
  }, [article])

  async function generate() {
    if (!keyword.trim()) return
    setLoading(true)
    setError('')
    setArticle(null)
    setProgressLabel('Starting…')

    try {
      const res = await fetch('/api/article-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: keyword.trim(),
          wordCount,
          tone,
          market: country,
          secondaryKeywords: clusterBrief?.secondaryKeywords ?? [],
          longTailKeywords: clusterBrief?.longTailKeywords ?? [],
          entities: nlpBrief?.entities ?? [],
          topicalGaps: nlpBrief?.topicalGaps ?? [],
          internalLinks: [],
          brand,
          userId: '',
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Server error' }))
        setError(err.error || 'Generation failed')
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let full = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        full += chunk
        const estimated = wordCount * 6
        const pct = Math.min(95, Math.round((full.length / estimated) * 100))
        if (pct < 20) setProgressLabel('Researching topic…')
        else if (pct < 40) setProgressLabel('Writing introduction…')
        else if (pct < 60) setProgressLabel('Adding expert insights…')
        else if (pct < 80) setProgressLabel('Writing FAQ and conclusion…')
        else if (full.includes('<!--SEORANKO_WITH_IMAGES_START-->')) setProgressLabel('Images embedded ✓')
        else if (full.includes('<!--SEORANKO_HUMANIZED_START-->')) setProgressLabel('Generating images…')
        else setProgressLabel('Humanising article…')
      }

      setProgressLabel('Complete ✓')

      // Stream error check
      const streamErr = full.match(/<!--SEORANKO_ERROR:([^-]+)-->/)
      if (streamErr) {
        setError(`Generation failed: ${decodeURIComponent(streamErr[1])}`)
        return
      }

      // Parse scores
      let qualityGate: ArticleOutput['qualityGate']
      let eeat = 0, readability = 0, kwDensity = 0, kwDensityScore = 0, humanScore: number | undefined
      let searchScore: number | undefined, aiScore: number | undefined
      let passesDetection: boolean | undefined, bannedWords: string[] | undefined
      let llmsTxtEntry: string | undefined, rankScore: number | undefined
      let factSourcingScore: number | undefined, factPatchedCount: number | undefined
      let linkAudit: ArticleOutput['linkAudit']

      const scoresMatch = full.match(/\n<!-- SEORANKO_SCORES:(\{[\s\S]*?\}) -->/)
      if (scoresMatch) {
        try {
          const p = JSON.parse(scoresMatch[1])
          eeat = p.eeatScore ?? 0
          readability = p.readabilityScore ?? 0
          kwDensity = p.keywordDensity ?? 0
          // keywordDensity is a raw percentage (e.g. 1.2 for 1.2%), not a /100
          // score — keywordDensityScore is the actual quality score. Fall back
          // to the old (broken) *10 behaviour only if an older API response
          // without the field is ever replayed.
          kwDensityScore = p.keywordDensityScore ?? Math.min(100, Math.round(kwDensity * 10))
          humanScore = p.humanScore
          searchScore = p.searchScore
          aiScore = p.aiScore
          passesDetection = p.passesDetection
          bannedWords = p.bannedWordsRemoved
          llmsTxtEntry = p.llmsTxtEntry
          rankScore = p.rankScore
          factSourcingScore = p.factSourcingScore
          factPatchedCount = p.factPatchedCount
          if (p.qualityGate) qualityGate = p.qualityGate
          if (p.linkAudit) linkAudit = p.linkAudit
        } catch { /* keep defaults */ }
        full = full.replace(/\n<!-- SEORANKO_SCORES:\{[\s\S]*?\} -->/, '')
      }

      // Pick best content version
      const withImagesMatch = full.match(/\n<!--SEORANKO_WITH_IMAGES_START-->\n([\s\S]*?)\n<!--SEORANKO_WITH_IMAGES_END-->/)
      const humanizedMatch  = full.match(/\n<!--SEORANKO_HUMANIZED_START-->\n([\s\S]*?)\n<!--SEORANKO_HUMANIZED_END-->/)
      const finalHtml = withImagesMatch
        ? withImagesMatch[1].trim()
        : humanizedMatch
          ? humanizedMatch[1].trim()
          : full.replace(/<!--[^>]*-->/g, '').trim()

      setArticle({
        seoTitle: keyword.trim(),
        metaDescription: '',
        article: finalHtml,
        wordCount,
        eeaScore: eeat,
        readabilityScore: readability,
        keywordDensity: kwDensity,
        keywordDensityScore: kwDensityScore,
        improvements: [],
        searchScore,
        aiScore,
        humanScore,
        passesDetection,
        bannedWordsRemoved: bannedWords,
        llmsTxtEntry,
        rankScore,
        factSourcingScore,
        factPatchedCount,
        qualityGate,
        linkAudit,
      })
    } catch (err: unknown) {
      setError(`Request failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  const wordCountDisplay = article
    ? article.article.replace(/<[^>]*>/g, '').trim().split(/\s+/).filter(Boolean).length
    : 0

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Write</h1>
        <p className="text-[#6B6B6B] text-sm">Generate an SEO + AEO + GEO-optimised article</p>
      </div>

      {/* Form */}
      <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">Target Keyword</label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && generate()}
              placeholder="e.g. best EV chargers UK"
              className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-4 py-2.5 text-sm focus:outline-none focus:border-[#FF6B2C]/50 transition-colors"
            />
            {nlpBrief && (nlpBrief.entities.length > 0 || nlpBrief.topicalGaps.length > 0) && (
              <p className="text-xs text-[#1D9E75] mt-1.5">
                ✓ Using your NLP brief — {nlpBrief.entities.length} entities, {nlpBrief.topicalGaps.length} topical gaps will guide generation
              </p>
            )}
            {clusterBrief && clusterBrief.secondaryKeywords.length > 0 && (
              <p className="text-xs text-[#1D9E75] mt-1.5">
                ✓ Cluster brief — will also weave in: {clusterBrief.secondaryKeywords.join(', ')}
              </p>
            )}
            {clusterBrief && clusterBrief.longTailKeywords.length > 0 && (
              <p className="text-xs text-[#1D9E75] mt-1">
                ✓ + {clusterBrief.longTailKeywords.length} long-tail terms (1-2 mentions each): {clusterBrief.longTailKeywords.join(', ')}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">Market</label>
            <select
              value={country}
              onChange={e => setCountry(e.target.value as Country)}
              className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2.5 text-sm focus:outline-none focus:border-[#FF6B2C]/50 transition-colors"
            >
              {ALL_COUNTRIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">Tone</label>
            <select
              value={tone}
              onChange={e => setTone(e.target.value as Tone)}
              className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2.5 text-sm focus:outline-none focus:border-[#FF6B2C]/50 transition-colors"
            >
              <option value="professional">Professional</option>
              <option value="conversational">Conversational</option>
              <option value="authoritative">Authoritative</option>
              <option value="friendly">Friendly</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">Target Word Count</label>
            <select
              value={wordCount}
              onChange={e => setWordCount(Number(e.target.value))}
              className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2.5 text-sm focus:outline-none focus:border-[#FF6B2C]/50 transition-colors"
            >
              <option value={1200}>1,200 words</option>
              <option value={1500}>1,500 words</option>
              <option value={2000}>2,000 words</option>
              <option value={2500}>2,500 words</option>
              <option value={3000}>3,000 words</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">Brand</label>
            <input
              type="text"
              value={brand}
              onChange={e => setBrand(e.target.value)}
              placeholder="e.g. autodun"
              className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-4 py-2.5 text-sm focus:outline-none focus:border-[#FF6B2C]/50 transition-colors"
            />
          </div>
        </div>

        <button
          onClick={generate}
          disabled={loading || !keyword.trim()}
          className="bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-50 disabled:cursor-not-allowed text-[#0a0a0a] font-semibold text-sm px-6 py-2.5 rounded-[8px] transition-colors flex items-center gap-2"
        >
          {loading && (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {loading ? progressLabel || 'Generating…' : 'Generate Article'}
        </button>

        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
      </div>

      {/* Progress bar */}
      {loading && (
        <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6 mb-6">
          <div className="flex justify-between text-xs text-[#6B6B6B] mb-2">
            <span>{progressLabel}</span>
          </div>
          <div className="h-2 bg-[#F5F4F1] rounded-full overflow-hidden">
            <div className="h-full bg-[#FF6B2C] rounded-full transition-all duration-500 w-3/4 animate-pulse" />
          </div>
          <div className="mt-4 flex gap-4 text-xs text-[#9B9B9B] flex-wrap">
            {['Detecting keyword', 'Auditing content', 'Scraping competitors', 'Verifying facts', 'Generating article', 'Humanising', 'Adding images'].map(s => (
              <span key={s}>{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Article output */}
      {article && !loading && (
        <div className="space-y-5">
          {/* Score rings */}
          <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[#0F0F0F]">Article Scores</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(article.article).then(() => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }).catch(() => {})
                  }}
                  className="flex items-center gap-2 bg-white border border-[#E8E8E4] hover:border-[#FF6B2C]/40 text-[#0F0F0F] font-medium text-xs px-3 py-1.5 rounded-[6px] transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  {copied ? '✅ Copied!' : 'Copy HTML'}
                </button>

                <ExportPackageButton
                  articleHtml={article.article}
                  title={keyword}
                  className="flex items-center gap-2 bg-[#FF6B2C] hover:bg-[#E85A1E] text-white font-medium text-xs px-3 py-1.5 rounded-[6px] disabled:opacity-50 transition-colors"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-6 justify-start">
              <ScoreRing score={article.eeaScore}        label="E-E-A-T"       color="#FF6B2C" />
              <ScoreRing score={article.readabilityScore} label="Readability"   color="#7C3AED" />
              <div className="flex flex-col items-center gap-1">
                <ScoreRing score={article.keywordDensityScore ?? 0} raw label="Keyword Density" color="#16a34a" />
                <span className="text-[9px] text-[#9B9B9B] -mt-1">{Number(article.keywordDensity).toFixed(1)}% actual</span>
              </div>
              {article.humanScore != null && (
                <ScoreRing score={article.humanScore}    label="Human Score"   color="#0ea5e9" />
              )}
              {article.factSourcingScore != null && (
                <ScoreRing score={article.factSourcingScore} label="Fact Sourcing" color="#f59e0b" />
              )}
              {article.rankScore != null && (
                <ScoreRing score={article.rankScore}     label="RANK Score"    color="#ec4899" />
              )}
            </div>

            {/* Stat bar */}
            <div className="flex gap-4 mt-4 pt-4 border-t border-[#F5F4F1] text-xs text-[#6B6B6B] flex-wrap">
              <span>📝 <strong className="text-[#0F0F0F]">{wordCountDisplay.toLocaleString()} words</strong></span>
              {article.searchScore != null && <span>🔍 <strong className="text-[#0F0F0F]">Search: {article.searchScore}/100</strong></span>}
              {article.aiScore != null && <span>🤖 <strong className="text-[#0F0F0F]">AI: {article.aiScore}/100</strong></span>}
              {article.passesDetection != null && (
                <span>{article.passesDetection ? '✅' : '⚠️'} <strong className="text-[#0F0F0F]">{article.passesDetection ? 'Passes detection' : 'May trigger detection'}</strong></span>
              )}
              {article.factPatchedCount != null && article.factPatchedCount > 0 && (
                <span>🔧 <strong className="text-[#0F0F0F]">{article.factPatchedCount} stats hedged</strong></span>
              )}
            </div>
          </div>

          {/* Recurring pipeline-bug alert — shown above Quality Gate since it's
              about the pipeline that produced this article, not this article alone */}
          {recurringAlerts.length > 0 && (
            <div className="p-4 bg-purple-50 border-2 border-purple-200 rounded-xl mb-3">
              <p className="text-sm font-semibold text-purple-800 mb-2">
                ⚠ Recurring pattern detected — likely a pipeline bug
              </p>
              {recurringAlerts.map(alert => (
                <p key={alert.category} className="text-xs text-purple-700 mb-1">
                  {alert.message}
                </p>
              ))}
            </div>
          )}

          {/* Quality Gate */}
          {article.qualityGate && (
            <QualityGatePanel result={article.qualityGate} />
          )}

          {/* Internal links — always visible, success or not, so a zero-link
              article is never silent about why */}
          {article.linkAudit && (
            <div className={`text-xs px-3 py-2 rounded-lg ${
              article.linkAudit.totalPlaced > 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
            }`}>
              {article.linkAudit.totalPlaced > 0
                ? `✓ ${article.linkAudit.totalPlaced} internal link${article.linkAudit.totalPlaced > 1 ? 's' : ''} added`
                : `⚠ No internal links added — ${article.linkAudit.note || 'reason unknown, check logs'}`
              }
            </div>
          )}

          {/* Alerts */}
          {article.aiScore != null && article.aiScore < 70 && (
            <div className="bg-amber-50 border border-amber-200 rounded-[8px] px-4 py-3 text-sm text-amber-800">
              ⚠️ <strong>AI Visibility score: {article.aiScore}/100</strong> — below the 70-point threshold. Consider adding more question-format headings.
            </div>
          )}

          {article.llmsTxtEntry && (
            <div className="bg-purple-50 border border-purple-200 rounded-[8px] px-4 py-3">
              <p className="text-xs font-semibold text-purple-800 mb-1">🤖 Suggested llms.txt entry:</p>
              <pre className="text-[10px] text-purple-700 font-mono whitespace-pre-wrap">{article.llmsTxtEntry}</pre>
            </div>
          )}

          {/* Article HTML */}
          <div className="bg-white border border-[#E8E8E4] rounded-[10px] overflow-hidden">
            <div className="px-5 py-3 border-b border-[#E8E8E4] flex items-center justify-between">
              <p className="text-xs font-semibold text-[#374151] uppercase tracking-wide">Article</p>
              <span className="text-xs text-[#9B9B9B]">{wordCountDisplay.toLocaleString()} words</span>
            </div>
            <div
              className="prose prose-sm max-w-none p-6"
              style={{ fontFamily: "'Outfit', sans-serif" }}
              dangerouslySetInnerHTML={{ __html: article.article }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

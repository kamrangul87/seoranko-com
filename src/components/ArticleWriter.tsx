'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { QualityGatePanel } from '@/components/QualityGatePanel'
import { ExportPackageButton } from '@/components/ExportPackageButton'
import { supabase } from '@/lib/supabase-client'
import type { ArticleOutput, Tone, Country } from '@/types'
import type { RecurringIssueAlert } from '@/lib/recurring-issue-detector'
import {
  MARKETS,
  DEFAULT_MARKET,
  WRITE_MARKET_STORAGE_KEY,
} from '@/lib/markets'
import {
  normalizeDomain,
  WRITE_BRAND_STORAGE_KEY,
  WRITE_DOMAIN_STORAGE_KEY,
} from '@/lib/brands'
import { countArticleWords, snapWordCount } from '@/lib/word-count'
import { filterRelatedKeywords } from '@/lib/topic-alignment'
import {
  applyPipelineStageEvent,
  initialPipelineStageState,
  markRemainingStagesSkipped,
  parsePipelineStageMarkers,
  parsePipelineStoppedMarker,
} from '@/lib/quality-pipeline-stages'
import { panelScoresFromMeta } from '@/lib/panel-scores'

const ALL_COUNTRIES = MARKETS.map(m => ({ value: m.value as Country, label: m.label }))

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
  const [country, setCountry]       = useState<Country>(DEFAULT_MARKET as Country)
  const [tone, setTone]             = useState<Tone>('professional')
  const [wordCount, setWordCount]   = useState(2000)
  const [brand, setBrand]           = useState('')
  const [domain, setDomain]         = useState('')
  const [loading, setLoading]       = useState(false)

  // §10 item 16 — NLP moves from a standalone Optimise tab to a Station-3
  // Brief input. Its output was already being written to localStorage
  // ('nlp_brief_data') but nothing ever read it — article-v2 has accepted
  // `entities`/`topicalGaps` as generation inputs all along, they were just
  // hardcoded to [] below. This is what actually makes NLP a brief input
  // rather than a dead-end analysis tool.
  //
  // The NLP page was already writing intent/serpFeatures/lsiTerms into this
  // same payload, plus gapScore/volume/competitionLevel once it started
  // capturing those from Discovery — none of it was being read here until
  // now, only entities/topicalGaps.
  const [nlpBrief, setNlpBrief] = useState<{
    entities: string[]
    topicalGaps: string[]
    intent?: string
    serpFeatures?: string[]
    gapScore?: number
    volume?: number
    competitionLevel?: string
  } | null>(null)

  // Station 2 (Plan) — when the Keywords screen clusters 2+ selected
  // keywords into one page brief, it stores the result here before routing
  // to Write. Previously this had no consumer, so Write always sent
  // secondaryKeywords: [keyword] (the primary keyword duplicated as its own
  // "secondary" — a no-op) regardless of what was selected.
  const [clusterBrief, setClusterBrief] = useState<{
    secondaryKeywords: string[]
    longTailKeywords: string[]
    pageId: string | null
    topicalGaps?: string[]
    entities?: string[]
    gapAnalysis?: {
      gapScore?: number
      volume?: number
      competitionLevel?: string
      serpFeatures?: string[]
    }
  } | null>(null)

  useEffect(() => {
    const kw = searchParams.get('keyword')

    const stored = localStorage.getItem('nlp_brief_data')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setNlpBrief({
          entities: parsed.entities ?? [],
          topicalGaps: parsed.topicalGaps ?? [],
          intent: parsed.intent,
          serpFeatures: parsed.serpFeatures,
          gapScore: parsed.gapScore,
          volume: parsed.volume,
          competitionLevel: parsed.competitionLevel,
        })
        if (parsed.targetMarket) setCountry(parsed.targetMarket as Country)
        if (parsed.country) setCountry(parsed.country as Country)
        if (parsed.wordCount) setWordCount(snapWordCount(Number(parsed.wordCount)))
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
          topicalGaps: parsed.topicalGaps ?? [],
          entities: parsed.entities ?? [],
          gapAnalysis: parsed.gapAnalysis,
        })
        if (parsed.country) setCountry(parsed.country as Country)
        if (parsed.targetMarket) setCountry(parsed.targetMarket as Country)
        if (parsed.wordCount) setWordCount(snapWordCount(Number(parsed.wordCount)))
        if (!kw && parsed.primaryKeyword) setKeyword(parsed.primaryKeyword)
      } catch { /* malformed — ignore, don't block generation */ }
      localStorage.removeItem('cluster_brief_data')
    }

    if (kw) setKeyword(kw)

    const urlCountry = searchParams.get('country')
    if (urlCountry && MARKETS.some(m => m.value === urlCountry)) {
      setCountry(urlCountry as Country)
    }

    const storedMarket = localStorage.getItem(WRITE_MARKET_STORAGE_KEY)
    if (storedMarket && MARKETS.some(m => m.value === storedMarket)) {
      setCountry(storedMarket as Country)
    }

    const storedBrand = localStorage.getItem(WRITE_BRAND_STORAGE_KEY)
    if (storedBrand) setBrand(storedBrand)

    const storedDomain = localStorage.getItem(WRITE_DOMAIN_STORAGE_KEY)
    if (storedDomain) setDomain(storedDomain)
  }, [searchParams])

  useEffect(() => {
    if (country) localStorage.setItem(WRITE_MARKET_STORAGE_KEY, country)
  }, [country])

  useEffect(() => {
    localStorage.setItem(WRITE_BRAND_STORAGE_KEY, brand)
  }, [brand])

  useEffect(() => {
    localStorage.setItem(WRITE_DOMAIN_STORAGE_KEY, domain)
  }, [domain])
  const [error, setError]           = useState('')
  const [article, setArticle]       = useState<ArticleOutput | null>(null)
  const [copied, setCopied]         = useState(false)
  const [progressLabel, setProgressLabel] = useState('')
  const [pipelineStages, setPipelineStages] = useState(initialPipelineStageState)
  const [pipelineStoppedReason, setPipelineStoppedReason] = useState<string | null>(null)
  const [recurringAlerts, setRecurringAlerts] = useState<RecurringIssueAlert[]>([])
  const [fixAllRunning, setFixAllRunning] = useState(false)
  const [fixAllReport, setFixAllReport] = useState<import('@/components/QualityGatePanel').FixAllReport | null>(null)
  const [editing, setEditing] = useState(false)
  const [draftHtml, setDraftHtml] = useState('')
  const [recheckRunning, setRecheckRunning] = useState(false)

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

  // Drop stale cluster-brief secondaries that don't match the current target
  // keyword (e.g. brief for "near me" left over while writing "types comparison").
  useEffect(() => {
    if (!clusterBrief || !keyword.trim()) return
    const related = filterRelatedKeywords(keyword, clusterBrief.secondaryKeywords)
    const relatedLong = filterRelatedKeywords(keyword, clusterBrief.longTailKeywords)
    if (
      related.length === clusterBrief.secondaryKeywords.length &&
      relatedLong.length === clusterBrief.longTailKeywords.length
    ) return

    if (related.length === 0 && relatedLong.length === 0) {
      setClusterBrief(null)
      return
    }
    setClusterBrief(prev => prev ? {
      ...prev,
      secondaryKeywords: related,
      longTailKeywords: relatedLong,
    } : null)
  }, [keyword, clusterBrief])

  async function runFixAll() {
    if (!article) return
    setFixAllRunning(true)
    setFixAllReport(null)
    try {
      const res = await fetch('/api/article-fix-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleHtml: article.article,
          keyword,
          brand,
          domain,
          targetWordCount: wordCount,
          articleId: article.articleId,
          save: !!article.articleId,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.blocked) {
        setError(data.warning || data.error || 'Fix All failed')
        return
      }
      setArticle({
        ...article,
        article: data.html,
        wordCount: countArticleWords(data.html),
        qualityGate: data.qualityGate,
        eeaScore: data.eeatScore ?? data.panelScores?.eeatScore ?? article.eeaScore,
        readabilityScore: data.readabilityScore ?? data.panelScores?.readabilityScore ?? article.readabilityScore,
        keywordDensity: data.keywordDensity ?? data.panelScores?.keywordDensity ?? article.keywordDensity,
        keywordDensityScore: data.keywordDensityScore ?? data.panelScores?.keywordDensityScore ?? article.keywordDensityScore,
      })
      setDraftHtml(data.html)
      setFixAllReport({
        fixed: data.fixed || [],
        stillNeedsManualReview: data.stillNeedsManualReview || [],
        summary: data.summary || '',
        scoreBefore: data.qualityGateBefore?.score,
        scoreAfter: data.qualityGate?.score,
        revalidationFoundAdditionalIssues: !!data.revalidationFoundAdditionalIssues,
      })
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fix All failed')
    } finally {
      setFixAllRunning(false)
    }
  }

  async function recheckQualityGate() {
    if (!article) return
    setRecheckRunning(true)
    try {
      const html = editing ? draftHtml : article.article
      const res = await fetch('/api/article-quality-recheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleHtml: html,
          keyword,
          brand,
          domain,
          targetWordCount: wordCount,
          applyAutoFixes: false,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Quality Gate recheck failed')
        return
      }
      setArticle({
        ...article,
        article: html,
        wordCount: countArticleWords(html),
        qualityGate: data.qualityGate,
        eeaScore: data.eeatScore ?? data.panelScores?.eeatScore ?? article.eeaScore,
        readabilityScore: data.readabilityScore ?? data.panelScores?.readabilityScore ?? article.readabilityScore,
        keywordDensity: data.keywordDensity ?? data.panelScores?.keywordDensity ?? article.keywordDensity,
        keywordDensityScore: data.keywordDensityScore ?? data.panelScores?.keywordDensityScore ?? article.keywordDensityScore,
      })
      setFixAllReport(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quality Gate recheck failed')
    } finally {
      setRecheckRunning(false)
    }
  }

  function startEditing() {
    if (!article) return
    setDraftHtml(article.article)
    setEditing(true)
  }

  function cancelEditing() {
    setEditing(false)
    setDraftHtml(article?.article || '')
  }

  function saveEdits() {
    if (!article) return
    setArticle({
      ...article,
      article: draftHtml,
      wordCount: countArticleWords(draftHtml),
    })
    setEditing(false)
    setFixAllReport(null)
  }

  async function generate() {
    if (!keyword.trim()) return
    setLoading(true)
    setError('')
    setArticle(null)
    setProgressLabel('Starting…')
    setPipelineStages(initialPipelineStageState())
    setPipelineStoppedReason(null)
    setFixAllReport(null)
    setEditing(false)

    try {
      // userId was previously hardcoded to '' here, which made
      // article-v2/route.ts's `if (brand && userId)` gate always fail and
      // skip the registry-backed internal-link pipeline on every single
      // article generated from this page — brand was always sent correctly,
      // only userId was missing. dashboard/layout.tsx already redirects to
      // /login before this component can render without a session, so this
      // should always resolve; the empty-string fallback is defensive only.
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id || ''

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
          entities: [
            ...(nlpBrief?.entities ?? []),
            ...(clusterBrief?.entities ?? []),
          ].filter((v, i, a) => a.indexOf(v) === i),
          topicalGaps: [
            ...(nlpBrief?.topicalGaps ?? []),
            ...(clusterBrief?.topicalGaps ?? []),
          ].filter((v, i, a) => a.indexOf(v) === i),
          gapAnalysis: clusterBrief?.gapAnalysis ?? (nlpBrief ? {
            gapScore: nlpBrief.gapScore,
            volume: nlpBrief.volume,
            competitionLevel: nlpBrief.competitionLevel,
            serpFeatures: nlpBrief.serpFeatures ?? [],
          } : undefined),
          internalLinks: [],
          brand: brand.trim(),
          domain: normalizeDomain(domain),
          userId,
          pageId: clusterBrief?.pageId ?? null,
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

        // Rebuild stage checklist from all markers seen so far (idempotent)
        const stageEvents = parsePipelineStageMarkers(full)
        const stopped = parsePipelineStoppedMarker(full)
        if (stageEvents.length > 0 || stopped) {
          let next = initialPipelineStageState()
          for (const ev of stageEvents) {
            next = applyPipelineStageEvent(next, ev)
          }
          if (stopped) {
            next = markRemainingStagesSkipped(next)
            setPipelineStoppedReason(stopped.reason)
            setProgressLabel(`Stopped: ${stopped.reason}`)
          } else if (stageEvents.length > 0) {
            const latest = stageEvents[stageEvents.length - 1]
            if (latest.status === 'running') setProgressLabel(latest.label)
            else if (latest.status === 'fail') setProgressLabel(`${latest.label} — failed`)
            else if (latest.status === 'partial') setProgressLabel(`${latest.label} — partially fixed`)
            else if (latest.status === 'fixed') setProgressLabel(`${latest.label} — fixed`)
            else if (latest.status === 'pass') setProgressLabel(`${latest.label} ✓`)
          }
          setPipelineStages(next)
        }
      }

      {
        const events = parsePipelineStageMarkers(full)
        const lastQg = [...events].reverse().find(e => e.id === 'quality-gate')
        if (parsePipelineStoppedMarker(full)) {
          /* progressLabel already set from stopped reason */
        } else if (lastQg?.status === 'partial') {
          setProgressLabel(`Partially fixed — ${lastQg.detail || 'issues remain'}`)
        } else if (lastQg?.status === 'fail') {
          setProgressLabel('Quality Gate — failed')
        } else if (lastQg?.status === 'fixed' || lastQg?.status === 'pass') {
          setProgressLabel(lastQg.detail ? `Complete · ${lastQg.detail}` : 'Complete ✓')
        } else {
          setProgressLabel('Complete ✓')
        }
      }

      // Stream error check
      const streamErrBlock = full.match(/<!--SEORANKO_ERROR_START-->([\s\S]*?)<!--SEORANKO_ERROR_END-->/)
      const streamErrLegacy = full.match(/<!--SEORANKO_ERROR:([\s\S]*?)-->/)
      const streamErrRaw = streamErrBlock?.[1] ?? streamErrLegacy?.[1]
      if (streamErrRaw) {
        try {
          setError(decodeURIComponent(streamErrRaw.trim()))
        } catch {
          setError(streamErrRaw.trim() || 'Generation failed')
        }
        setPipelineStages(prev => markRemainingStagesSkipped(prev))
        // Still try to surface partial HTML when the pipeline stopped mid-way
        const withImagesMatch = full.match(/\n<!--SEORANKO_WITH_IMAGES_START-->\n([\s\S]*?)\n<!--SEORANKO_WITH_IMAGES_END-->/)
        const humanizedMatch  = full.match(/\n<!--SEORANKO_HUMANIZED_START-->\n([\s\S]*?)\n<!--SEORANKO_HUMANIZED_END-->/)
        const partialHtml = withImagesMatch
          ? withImagesMatch[1].trim()
          : humanizedMatch
            ? humanizedMatch[1].trim()
            : ''
        if (partialHtml.length > 200) {
          let qualityGate: ArticleOutput['qualityGate']
          let panel = {
            eeatScore: 0,
            readabilityScore: 0,
            keywordDensity: 0,
            keywordDensityScore: 0,
          }
          const scoresMatch = full.match(/\n<!-- SEORANKO_SCORES:(\{[\s\S]*?\}) -->/)
          if (scoresMatch) {
            try {
              const p = JSON.parse(scoresMatch[1])
              if (p.qualityGate) qualityGate = p.qualityGate
              // Never hardcode rings to 0 when the stream already sent real
              // scores for this same article — that produced the contradictory
              // "0/100 rings vs real Quality Gate" bug on pipeline stop.
              const fromMeta = panelScoresFromMeta(p)
              if (fromMeta) panel = fromMeta
            } catch { /* ignore */ }
          }
          setArticle({
            seoTitle: keyword.trim(),
            metaDescription: '',
            article: partialHtml,
            wordCount: countArticleWords(partialHtml),
            eeaScore: panel.eeatScore,
            readabilityScore: panel.readabilityScore,
            keywordDensity: panel.keywordDensity,
            keywordDensityScore: panel.keywordDensityScore,
            improvements: [],
            qualityGate,
            saveError: 'Generation stopped by Quality Pipeline — article was not saved.',
          })
        }
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
      let articleId: string | undefined, saveError: string | undefined
      let proseWordCount: number | undefined

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
          if (typeof p.wordCount === 'number') proseWordCount = p.wordCount
          if (p.qualityGate) qualityGate = p.qualityGate
          if (p.linkAudit) linkAudit = p.linkAudit
          articleId = p.articleId
          saveError = p.saveError
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

      const actualWordCount = proseWordCount ?? countArticleWords(finalHtml)

      setArticle({
        seoTitle: keyword.trim(),
        metaDescription: '',
        article: finalHtml,
        wordCount: actualWordCount,
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
        articleId,
        saveError,
      })
    } catch (err: unknown) {
      setError(`Request failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  const wordCountDisplay = article ? article.wordCount : 0

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
              <div className="mt-2 p-3 bg-[#1D9E75]/5 border border-[#1D9E75]/20 rounded-[8px] text-xs space-y-1.5">
                <p className="text-[#1D9E75] font-medium">
                  ✓ Using your NLP gap analysis for this article
                  {nlpBrief.gapScore != null && ` — gap score ${nlpBrief.gapScore}/100`}
                  {nlpBrief.volume != null && ` · ${nlpBrief.volume.toLocaleString()}/mo volume`}
                  {nlpBrief.competitionLevel && ` · ${nlpBrief.competitionLevel} competition`}
                </p>
                {nlpBrief.entities.length > 0 && (
                  <p className="text-[#6B6B6B]">
                    <span className="font-medium text-[#374151]">Entities ({nlpBrief.entities.length}):</span>{' '}
                    {nlpBrief.entities.slice(0, 8).join(', ')}{nlpBrief.entities.length > 8 ? '…' : ''}
                  </p>
                )}
                {nlpBrief.topicalGaps.length > 0 && (
                  <p className="text-[#6B6B6B]">
                    <span className="font-medium text-[#374151]">Subtopics to cover ({nlpBrief.topicalGaps.length}):</span>{' '}
                    {nlpBrief.topicalGaps.slice(0, 6).join(', ')}{nlpBrief.topicalGaps.length > 6 ? '…' : ''}
                  </p>
                )}
                {nlpBrief.serpFeatures && nlpBrief.serpFeatures.length > 0 && (
                  <p className="text-[#6B6B6B]">
                    <span className="font-medium text-[#374151]">SERP targets:</span> {nlpBrief.serpFeatures.join(', ')}
                  </p>
                )}
              </div>
            )}
            {clusterBrief && clusterBrief.secondaryKeywords.length > 0 && (
              <p className="text-xs text-[#1D9E75] mt-1.5">
                ✓ Cluster brief — targeting {clusterBrief.secondaryKeywords.length} keyword{clusterBrief.secondaryKeywords.length > 1 ? 's' : ''}: {clusterBrief.secondaryKeywords.join(', ')}
                <span className="text-[#9B9B9B]"> (Quality Gate will flag any that don&apos;t make it in)</span>
              </p>
            )}
            {clusterBrief && (clusterBrief.topicalGaps?.length ?? 0) > 0 && (
              <p className="text-xs text-[#1D9E75] mt-1">
                ✓ SERP gaps to cover: {clusterBrief.topicalGaps!.slice(0, 4).join(', ')}
                {(clusterBrief.topicalGaps!.length > 4) ? '…' : ''}
                {clusterBrief.gapAnalysis?.gapScore != null && ` · gap score ${clusterBrief.gapAnalysis.gapScore}/100`}
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
              <option value={1500}>1,500 words</option>
              <option value={2000}>2,000 words</option>
              <option value={2500}>2,500 words</option>
              <option value={3000}>3,000 words</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">Brand / Site name</label>
            <input
              type="text"
              value={brand}
              onChange={e => setBrand(e.target.value)}
              placeholder="e.g. My Company"
              className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2.5 text-sm focus:outline-none focus:border-[#FF6B2C]/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">Website domain</label>
            <input
              type="text"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              placeholder="e.g. example.com"
              className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2.5 text-sm focus:outline-none focus:border-[#FF6B2C]/50 transition-colors"
            />
            <p className="text-[10px] text-[#9B9B9B] mt-1">
              Used for schema, canonical URL, and internal links. Enter your own site — not a preset.
            </p>
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

      {/* Quality Pipeline — real per-stage status from the article-v2 stream */}
      {(loading || pipelineStages.some(s => s.status !== 'pending')) && (
        <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6 mb-6">
          <div className="flex justify-between items-start gap-3 text-xs text-[#6B6B6B] mb-3">
            <div>
              <p className="text-sm font-semibold text-[#0F0F0F]">Quality Pipeline</p>
              <p className="mt-0.5">{progressLabel || 'Starting…'}</p>
            </div>
            {loading && (
              <svg className="w-4 h-4 animate-spin shrink-0 text-[#FF6B2C]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </div>
          <ol className="space-y-2">
            {pipelineStages.map((stage, idx) => {
              const statusClass =
                stage.status === 'pass' ? 'text-[#1D9E75]'
                : stage.status === 'fixed' ? 'text-[#1D9E75]'
                : stage.status === 'partial' ? 'text-[#B45309]'
                : stage.status === 'fail' ? 'text-red-600'
                : stage.status === 'running' ? 'text-[#0F0F0F]'
                : stage.status === 'skipped' ? 'text-[#C4C4C0]'
                : 'text-[#9B9B9B]'
              const mark =
                stage.status === 'pass' ? '✓'
                : stage.status === 'fixed' ? '✓ fixed'
                : stage.status === 'partial' ? '~ partial'
                : stage.status === 'fail' ? '✕'
                : stage.status === 'running' ? '…'
                : stage.status === 'skipped' ? '—'
                : String(idx + 1)
              return (
                <li key={stage.id} className={`flex gap-3 text-sm ${statusClass}`}>
                  <span className="w-14 shrink-0 font-mono text-xs pt-0.5">{mark}</span>
                  <div className="min-w-0">
                    <p className={`leading-snug ${stage.status === 'running' ? 'font-semibold' : ''}`}>
                      {stage.label}
                    </p>
                    {stage.detail && (
                      <p className="text-xs text-[#6B6B6B] mt-0.5 break-words">{stage.detail}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
          {pipelineStoppedReason && (
            <div className="mt-4 rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <p className="font-semibold">Pipeline stopped</p>
              <p className="text-xs mt-1">{pipelineStoppedReason}</p>
            </div>
          )}
        </div>
      )}

      {/* Article output */}
      {article && !loading && (
        <div className="space-y-5">
          {/* Save status — a save failure happens AFTER a successful
              generation, so the article is still shown below; this makes
              the failure impossible to miss instead of a silent 200 with
              a generated-but-unsaved article. */}
          {article.saveError && (
            <div className="bg-red-50 border border-red-200 rounded-[10px] px-4 py-3 text-sm text-red-800">
              <p className="font-semibold">⚠ This article was NOT saved — {article.saveError}</p>
              <p className="text-xs text-red-600 mt-1">Copy the HTML now (below) before leaving this page, or it will be lost.</p>
            </div>
          )}

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
              {article.qualityGate && (
                <ScoreRing score={article.qualityGate.score} raw label="Quality Gate" color="#0F0F0F" />
              )}
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
              <span>📝 <strong className="text-[#0F0F0F]">{wordCountDisplay.toLocaleString()} words</strong>
                {wordCountDisplay > wordCount * 1.12 && (
                  <span className="text-amber-600 ml-1">(target {wordCount.toLocaleString()})</span>
                )}
              </span>
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
            <QualityGatePanel
              result={article.qualityGate}
              onFixAll={runFixAll}
              fixAllRunning={fixAllRunning}
              fixAllReport={fixAllReport}
            />
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

          {/* Article HTML — view / inline edit */}
          <div className="bg-white border border-[#E8E8E4] rounded-[10px] overflow-hidden">
            <div className="px-5 py-3 border-b border-[#E8E8E4] flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-semibold text-[#374151] uppercase tracking-wide">Article</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-[#9B9B9B]">{wordCountDisplay.toLocaleString()} words</span>
                {!editing ? (
                  <>
                    <button
                      type="button"
                      onClick={startEditing}
                      className="text-xs font-medium px-3 py-1.5 border border-[#E8E8E4] rounded-[6px] hover:border-[#FF6B2C]/40 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={recheckQualityGate}
                      disabled={recheckRunning}
                      className="text-xs font-medium px-3 py-1.5 border border-[#E8E8E4] rounded-[6px] hover:border-[#FF6B2C]/40 disabled:opacity-50 transition-colors"
                    >
                      {recheckRunning ? 'Re-checking…' : 'Re-check Quality Gate'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={cancelEditing}
                      className="text-xs font-medium px-3 py-1.5 border border-[#E8E8E4] rounded-[6px] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveEdits}
                      className="text-xs font-semibold px-3 py-1.5 bg-[#0F0F0F] text-white rounded-[6px] transition-colors"
                    >
                      Save edits
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setRecheckRunning(true)
                        try {
                          const res = await fetch('/api/article-quality-recheck', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              articleHtml: draftHtml,
                              keyword,
                              brand,
                              domain,
                              targetWordCount: wordCount,
                            }),
                          })
                          const data = await res.json()
                          if (res.ok && article) {
                            setArticle({
                              ...article,
                              article: draftHtml,
                              wordCount: countArticleWords(draftHtml),
                              qualityGate: data.qualityGate,
                              eeaScore: data.eeatScore ?? data.panelScores?.eeatScore ?? article.eeaScore,
                              readabilityScore: data.readabilityScore ?? data.panelScores?.readabilityScore ?? article.readabilityScore,
                              keywordDensity: data.keywordDensity ?? data.panelScores?.keywordDensity ?? article.keywordDensity,
                              keywordDensityScore: data.keywordDensityScore ?? data.panelScores?.keywordDensityScore ?? article.keywordDensityScore,
                            })
                            setEditing(false)
                            setFixAllReport(null)
                          } else {
                            setError(data.error || 'Recheck failed')
                          }
                        } finally {
                          setRecheckRunning(false)
                        }
                      }}
                      disabled={recheckRunning}
                      className="text-xs font-semibold px-3 py-1.5 bg-[#FF6B2C] text-white rounded-[6px] disabled:opacity-50 transition-colors"
                    >
                      {recheckRunning ? 'Saving…' : 'Save & re-check'}
                    </button>
                  </>
                )}
              </div>
            </div>
            {editing ? (
              <textarea
                value={draftHtml}
                onChange={e => setDraftHtml(e.target.value)}
                className="w-full min-h-[480px] p-6 text-sm font-mono leading-relaxed border-0 focus:outline-none focus:ring-0 bg-[#FAFAF8]"
                spellCheck
                aria-label="Edit article HTML"
              />
            ) : (
              <div
                className="prose prose-sm max-w-none p-6"
                style={{ fontFamily: "'Outfit', sans-serif" }}
                dangerouslySetInnerHTML={{ __html: article.article }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

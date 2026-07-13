'use client'
import { useState } from 'react'
import { auditHeadingStructure, auditAuthorityLinks, scoreContentFreshness } from '@/lib/aeo-signals'

interface ContentScoresProps {
  scores: {
    eeat: number
    readability: number
    searchSeo: number
    aiVisibility: number
    humanScore?: number | null
    factSourcing?: number | null
  }
  articleId?: string
  articleContent: string
  keyword: string
  title?: string
  wordCount?: number
  keywordDensity?: number
  publishDate?: string
  onArticleImproved: (newContent: string, target: string) => void
}

interface ScoreItem {
  label: string
  value: number | null | undefined
  target: string
  color: string
  warning?: string
}

export function ContentScores({
  scores, articleId, articleContent, keyword, title,
  wordCount, keywordDensity, publishDate, onArticleImproved
}: ContentScoresProps) {
  const headingAudit = auditHeadingStructure(articleContent)
  const authorityAudit = auditAuthorityLinks(articleContent)
  const freshness = scoreContentFreshness(publishDate || new Date().toISOString())
  const [improving, setImproving] = useState<string | null>(null)
  const [improved, setImproved] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [streamPreview, setStreamPreview] = useState('')

  const scoreItems: ScoreItem[] = [
    { label: 'EEAT', value: scores.eeat, target: 'eeat', color: '#f59e0b' },
    { label: 'Readability', value: scores.readability, target: 'readability', color: '#22c55e' },
    { label: 'Search SEO', value: scores.searchSeo, target: 'keyword_density', color: '#1a56db' },
    { label: 'AI Visibility', value: scores.aiVisibility, target: 'fact_sourcing', color: '#f97316' },
    ...(scores.humanScore != null ? [{
      label: 'Human Score', value: scores.humanScore, target: 'human_score', color: '#7C3AED',
      warning: (scores.humanScore ?? 0) < 80 ? 'May trigger AI detection' : undefined
    }] : []),
    ...(scores.factSourcing != null ? [{
      label: 'Fact Sourcing', value: scores.factSourcing, target: 'fact_sourcing', color: '#0891b2'
    }] : []),
  ]

  async function handleImprove(target: string, currentScore: number) {
    setImproving(target)
    setError(null)
    setStreamPreview('')

    try {
      const response = await fetch('/api/improve-article-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleContent, target, currentScore, keyword, title, articleId })
      })

      if (!response.ok) throw new Error(`Server error: ${response.status}`)

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''

      if (!reader) throw new Error('No response stream')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        fullContent += chunk
        setStreamPreview(fullContent.slice(-120))
      }

      const cleanContent = fullContent.replace(/<!--\s*CHANGES:[\s\S]*?-->/g, '').trim()
      if (cleanContent) {
        onArticleImproved(cleanContent, target)
      }
      setImproved(prev => ({ ...prev, [target]: true }))

      if (articleId && cleanContent) {
        fetch('/api/improve-article', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ articleId, articleContent: cleanContent, target, currentScore, keyword, title })
        }).catch(() => {})
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setImproving(null)
      setStreamPreview('')
    }
  }

  async function handleImproveAll() {
    const lowestScore = Math.min(
      scores.eeat ?? 100, scores.readability ?? 100, scores.humanScore ?? 100
    )
    await handleImprove('all', lowestScore)
  }

  function getScoreColor(value: number | null | undefined): string {
    if (value == null) return '#9ca3af'
    return value >= 90 ? '#22c55e' : value >= 70 ? '#f97316' : '#6b7280'
  }

  function ScoreRing({ value, label, target, warning }: { value: number | null | undefined; label: string; target: string; warning?: string }) {
    const v = value ?? 0
    const circumference = 2 * Math.PI * 20
    const offset = circumference - (v / 100) * circumference
    const color = getScoreColor(value)
    const isImproving = improving === target
    const isDone = improved[target]
    const needsImprovement = value != null && value < 90

    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className="relative w-14 h-14">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="20" fill="none" stroke="#f3f4f6" strokeWidth="4" />
            <circle
              cx="24" cy="24" r="20" fill="none"
              stroke={color} strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={isImproving ? circumference * 0.5 : offset}
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {isImproving ? (
              <svg className="w-4 h-4 animate-spin text-orange-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : isDone ? (
              <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <span className="text-xs font-bold text-gray-800">{value ?? '—'}</span>
            )}
          </div>
        </div>
        <span className="text-xs text-gray-500 text-center leading-tight">{label}</span>
        {warning && (
          <span className="text-xs text-amber-600 text-center leading-tight">⚠ {warning}</span>
        )}
        {needsImprovement && !isDone && (
          <button
            onClick={() => handleImprove(target, v)}
            disabled={!!improving}
            className="text-xs text-orange-500 hover:text-orange-600 underline underline-offset-2 disabled:opacity-40 disabled:no-underline transition-colors"
          >
            {isImproving ? 'Working…' : '↑ Improve'}
          </button>
        )}
        {isDone && <span className="text-xs text-green-600 font-medium">✓ Improved</span>}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-gray-800">Content Scores</span>
        <button
          onClick={handleImproveAll}
          disabled={!!improving}
          className="flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700 border border-orange-200 hover:border-orange-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {improving === 'all' ? 'Improving…' : '↑ Improve All'}
        </button>
      </div>

      {improving && streamPreview && (
        <div className="mb-3 p-2 bg-orange-50 rounded-lg border border-orange-100">
          <div className="text-xs text-orange-600 font-medium mb-1">Improving {improving}…</div>
          <div className="text-xs text-gray-500 font-mono truncate">{streamPreview}</div>
        </div>
      )}

      {error && (
        <div className="mb-3 p-2 bg-red-50 rounded-lg border border-red-100 text-xs text-red-600">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-4">
        {scoreItems.map(item => (
          <ScoreRing
            key={item.label}
            value={item.value}
            label={item.label}
            target={item.target}
            warning={item.warning}
          />
        ))}
      </div>

      <div className="border-t border-gray-100 pt-3 space-y-1.5">
        {wordCount != null && (
          <div className="flex justify-between">
            <span className="text-xs text-gray-500">Word Count</span>
            <span className="text-xs font-medium text-gray-800">{wordCount.toLocaleString()}</span>
          </div>
        )}
        {keywordDensity != null && (
          <div className="flex justify-between">
            <span className="text-xs text-gray-500">Keyword Density</span>
            <span className={`text-xs font-medium ${keywordDensity < 0.5 ? 'text-amber-600' : keywordDensity > 2.5 ? 'text-red-500' : 'text-green-600'}`}>
              {keywordDensity.toFixed(1)}%
              {keywordDensity < 0.5 && ' ↓ low'}
              {keywordDensity > 2.5 && ' ↑ high'}
            </span>
          </div>
        )}
      </div>

      {/* AEO Signals */}
      <div className="border-t border-gray-100 pt-3 mt-3 space-y-2">
        <p className="text-xs font-medium text-gray-500 mb-2">AEO signals</p>

        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Question headings</span>
          <div className="flex items-center gap-1.5">
            <span className={`text-xs font-medium ${headingAudit.grade === 'A' ? 'text-green-600' : headingAudit.grade === 'B' ? 'text-blue-600' : 'text-amber-600'}`}>
              {headingAudit.questionH2}/{headingAudit.totalH2}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${headingAudit.grade === 'A' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
              {headingAudit.grade}
            </span>
            {headingAudit.grade !== 'A' && !improved['heading_structure'] && (
              <button
                onClick={() => handleImprove('heading_structure', 0)}
                disabled={!!improving}
                className="text-xs text-orange-500 hover:text-orange-600 underline underline-offset-2 disabled:opacity-40 transition-colors"
              >
                {improving === 'heading_structure' ? '…' : '↑ Fix'}
              </button>
            )}
            {improved['heading_structure'] && <span className="text-xs text-green-600">✓</span>}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Authority links</span>
          <div className="flex items-center gap-1.5">
            <span className={`text-xs font-medium ${authorityAudit.totalAuthorityLinks >= 2 ? 'text-green-600' : 'text-amber-600'}`}>
              {authorityAudit.totalAuthorityLinks} .gov/.org
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${authorityAudit.grade === 'A' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
              {authorityAudit.grade}
            </span>
            {authorityAudit.grade !== 'A' && !improved['authority_links'] && (
              <button
                onClick={() => handleImprove('authority_links', 0)}
                disabled={!!improving}
                className="text-xs text-orange-500 hover:text-orange-600 underline underline-offset-2 disabled:opacity-40 transition-colors"
              >
                {improving === 'authority_links' ? '…' : '↑ Add'}
              </button>
            )}
            {improved['authority_links'] && <span className="text-xs text-green-600">✓</span>}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Freshness</span>
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ background: freshness.color + '18', color: freshness.color }}
          >
            {freshness.label} · {freshness.daysSincePublish}d
          </span>
        </div>

        {headingAudit.issues.length > 0 && (
          <div className="mt-2 p-2 bg-amber-50 rounded border border-amber-100">
            {headingAudit.issues.map((issue, i) => (
              <p key={i} className="text-xs text-amber-700">• {issue}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

import { describe, it, expect } from 'vitest'
import {
  buildExplainableScore,
  formatDimensionBoard,
} from '@/lib/quality-score-dimensions'
import {
  SEO_HEURISTICS,
  NOT_GOOGLE_RANKING_SIGNALS,
  isMagicGoogleMyth,
  keywordPresenceHeuristic,
} from '@/lib/google-seo-policy'
import { recomputeQualityGateTotals, scoreFloorIssues } from '@/lib/article-quality-gate'

describe('Phase 10 — explainable score dimensions', () => {
  it('builds the structured dimension board with PASS / REVIEW / ADVISORY', () => {
    const result = buildExplainableScore([
      {
        id: 'schema-ok',
        category: 'schema',
        severity: 'critical',
        title: 'Article: headline missing',
      },
      {
        id: 'freshness-1',
        category: 'dated-policy',
        severity: 'warning',
        title: 'Time-sensitive claim',
      },
      {
        id: 'word-count-advisory',
        category: 'word-count',
        severity: 'info',
        title: 'Shorter than preferred length',
      },
    ])

    const board = Object.fromEntries(result.dimensions.map((d) => [d.label, d.status]))
    expect(board['Technical SEO']).toBe('PASS')
    expect(board['Structured Data']).toBe('FAIL')
    expect(board['Factual Verification']).toBe('PASS')
    expect(board['Freshness']).toBe('REVIEW')
    expect(board['Readability']).toBe('PASS')
    expect(board['Internal Linking']).toBe('PASS')
    expect(board['Editorial']).toBe('ADVISORY')
    expect(board['Core Web Vitals']).toBe('PASS')
    expect(result.dimensions).toHaveLength(8)

    expect(formatDimensionBoard(result)).toContain('Structured Data: FAIL')
    expect(formatDimensionBoard(result)).toContain('Editorial: ADVISORY')
  })

  it('score ignores advisory/info — editorial does not dominate', () => {
    const withAdvisory = buildExplainableScore([
      {
        id: 'word-count-advisory',
        category: 'word-count',
        severity: 'info',
        title: 'Shorter than preferred',
      },
      {
        id: 'word-count-advisory-2',
        category: 'word-count',
        severity: 'info',
        title: 'Another editorial note',
      },
    ])
    expect(withAdvisory.score).toBe(100)
    expect(withAdvisory.publishDecision).toBe('READY')
    expect(withAdvisory.scoreExplanation).toMatch(/do not reduce the score/)

    const withWarning = buildExplainableScore([
      {
        id: 'word-count-advisory',
        category: 'word-count',
        severity: 'info',
        title: 'Advisory',
      },
      {
        id: 'hedging-1',
        category: 'hedging',
        severity: 'warning',
        title: 'Over-hedging',
      },
    ])
    // Only the warning reduces score (100 − 5), not the info
    expect(withWarning.score).toBe(95)
    expect(withWarning.publishDecision).toBe('NEEDS_REVIEW')
  })

  it('recomputeQualityGateTotals exposes explainable board and READY only with no warnings', () => {
    const clean = recomputeQualityGateTotals({
      issues: [
        {
          id: 'word-count-advisory',
          severity: 'info',
          category: 'word-count',
          title: 'Preferred length note',
          description: 'editorial',
          autoFixable: false,
        },
      ],
      autoFixedCount: 0,
      articleAfterAutoFix: '<p>ok</p>',
    })
    expect(clean.score).toBe(100)
    expect(clean.readyToPublish).toBe(true)
    expect(clean.explainable.publishDecision).toBe('READY')
    expect(clean.explainable.dimensions.find((d) => d.id === 'editorial')?.status).toBe(
      'ADVISORY',
    )

    const needsReview = recomputeQualityGateTotals({
      issues: [
        {
          id: 'dated-1',
          severity: 'warning',
          category: 'dated-policy',
          title: 'Check claim',
          description: 'x',
          autoFixable: false,
        },
      ],
      autoFixedCount: 0,
      articleAfterAutoFix: '<p>ok</p>',
    })
    expect(needsReview.score).toBe(95)
    expect(needsReview.readyToPublish).toBe(false)
    expect(needsReview.explainable.publishDecision).toBe('NEEDS_REVIEW')
  })

  it('critical severity weights: −20 each; warnings −5', () => {
    const result = buildExplainableScore([
      { id: 'a', category: 'schema', severity: 'critical', title: 'A' },
      { id: 'b', category: 'schema', severity: 'critical', title: 'B' },
      { id: 'c', category: 'hedging', severity: 'warning', title: 'C' },
      { id: 'd', category: 'word-count', severity: 'info', title: 'D' },
    ])
    expect(result.score).toBe(55) // 100 − 40 − 5
    expect(result.publishDecision).toBe('BLOCKED')
  })
})

describe('Phase 12 — Google-aligned SEO heuristics (not magic rules)', () => {
  it('documents myths that must never be enforced as Google ranking rules', () => {
    for (const myth of NOT_GOOGLE_RANKING_SIGNALS) {
      expect(isMagicGoogleMyth(myth)).toBe(true)
    }
    expect(isMagicGoogleMyth('structured_data_validity')).toBe(false)

    const density = SEO_HEURISTICS.find((h) => h.id === 'keyword-density')
    expect(density?.treatment).toBe('never_enforce_as_google_rule')

    const wordCount = SEO_HEURISTICS.find((h) => h.id === 'editorial-word-count')
    expect(wordCount?.treatment).toBe('never_enforce_as_google_rule')
  })

  it('keyword presence heuristic is review-only, never a critical Google floor', () => {
    expect(keywordPresenceHeuristic({ keywordDensityPct: 0.05, keywordDensityScore: 5 })).toBe(
      'review',
    )
    expect(keywordPresenceHeuristic({ keywordDensityPct: 1.2, keywordDensityScore: 70 })).toBe(
      'ok',
    )

    const floors = scoreFloorIssues({
      keywordDensityPct: 0.05,
      keywordDensityScore: 5,
      keyword: 'home charger',
    })
    const density = floors.find((i) => i.id === 'score-floor-keyword-density')
    expect(density?.severity).toBe('warning')
    expect(density?.description).toMatch(/not a Google ranking/i)
  })
})

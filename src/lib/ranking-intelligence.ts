// src/lib/ranking-intelligence.ts
// The brain of the Ranking Agent — analyses why an article isn't ranking
// and decides what to do about it automatically

import Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient } from '@/lib/anthropic'

export interface RankingDiagnosis {
  overallHealth: 'excellent' | 'good' | 'needs-work' | 'critical'
  primaryIssue: string
  secondaryIssues: string[]
  recommendedAction: 'none' | 'refresh' | 'improve-eeat' | 'improve-readability' |
                     'improve-human-score' | 'improve-facts' | 'full-rewrite' | 'new-article'
  reasoning: string
  estimatedRecoveryTime: string
  competitorInsight: string
  quickWins: string[]
}

export interface ArticleRankingContext {
  keyword: string
  currentPosition: number | null
  previousPosition: number | null
  positionChange: number | null
  rankScore: number
  eeatScore: number
  readabilityScore: number
  humanScore: number
  factScore: number
  daysSincePublish: number
  isCited: boolean | null
  topCompetitor: string | null
  serpFeatures: string[]
}

const client = getAnthropicClient()

export async function diagnoseRankingIssues(
  context: ArticleRankingContext
): Promise<RankingDiagnosis> {

  const prompt = `You are an expert SEO analyst diagnosing why an article is or isn't ranking well.

Article ranking context:
- Target keyword: "${context.keyword}"
- Current Google position: ${context.currentPosition ? `#${context.currentPosition}` : 'Not in top 100'}
- Previous position: ${context.previousPosition ? `#${context.previousPosition}` : 'Unknown'}
- Position change: ${context.positionChange !== null ? (context.positionChange < 0 ? `Improved by ${Math.abs(context.positionChange)}` : `Dropped by ${context.positionChange}`) : 'Unknown'}
- RANK score: ${context.rankScore}/100
- EEAT score: ${context.eeatScore}/100
- Readability score: ${context.readabilityScore}/100
- Human score (AI detection): ${context.humanScore}/100
- Fact sourcing score: ${context.factScore}/100
- Days since published: ${context.daysSincePublish}
- Cited by AI engines: ${context.isCited === null ? 'Not checked' : context.isCited ? 'Yes' : 'No'}
- Top competitor for this keyword: ${context.topCompetitor || 'Unknown'}
- SERP features present: ${context.serpFeatures.join(', ') || 'None detected'}

Based on this data, provide a diagnosis in this exact JSON format:
{
  "overallHealth": "excellent|good|needs-work|critical",
  "primaryIssue": "single most important problem in one sentence",
  "secondaryIssues": ["issue 1", "issue 2", "issue 3"],
  "recommendedAction": "none|refresh|improve-eeat|improve-readability|improve-human-score|improve-facts|full-rewrite|new-article",
  "reasoning": "2-3 sentence plain English explanation of why this article is or isn't ranking",
  "estimatedRecoveryTime": "realistic timeframe like '2-4 weeks with these changes'",
  "competitorInsight": "what the top competitor is likely doing better based on the data",
  "quickWins": ["quick win 1", "quick win 2", "quick win 3"]
}

Respond with JSON only, no other text.`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean) as RankingDiagnosis
  } catch {
    return {
      overallHealth: context.rankScore >= 80 ? 'good' : 'needs-work',
      primaryIssue: context.currentPosition === null
        ? 'Article not yet indexed or ranking outside top 100'
        : `Article ranked at #${context.currentPosition} — needs optimisation to reach page 1`,
      secondaryIssues: [],
      recommendedAction: context.rankScore < 60 ? 'improve-eeat' : 'refresh',
      reasoning: 'Analysis based on available score data.',
      estimatedRecoveryTime: '2-4 weeks',
      competitorInsight: 'Check the top-ranking page for this keyword to understand what is working.',
      quickWins: ['Improve fact density', 'Add more authoritative external links', 'Refresh publish date']
    }
  }
}

export async function generateWeeklySummary(
  articles: ArticleRankingContext[]
): Promise<string> {
  const ranked = articles.filter(a => a.currentPosition !== null)
  const page1 = ranked.filter(a => a.currentPosition! <= 10)
  // §10 item 10 / §6.4: negative Δposition = good.
  const dropped = articles.filter(a => a.positionChange !== null && a.positionChange > 3)
  const improved = articles.filter(a => a.positionChange !== null && a.positionChange < -3)

  if (articles.length === 0) return 'No articles tracked yet — add your first article to the Ranking Agent.'

  const parts = []
  if (page1.length > 0) parts.push(`${page1.length} article${page1.length > 1 ? 's' : ''} on Page 1`)
  if (improved.length > 0) parts.push(`${improved.length} improved this week`)
  if (dropped.length > 0) parts.push(`${dropped.length} dropped — auto-fix applied`)

  return parts.length > 0
    ? parts.join(' · ')
    : `${ranked.length} articles tracked · monitoring weekly`
}

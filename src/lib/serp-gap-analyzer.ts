// SERP content-gap analysis — compares top-ranking pages for a keyword and
// surfaces subtopics competitors cover (and gaps to exploit). Same idea as
// Serper/SERP gap tools: scrape top results → extract topics → guide the brief.

import {
  getTopCompetitorUrls,
  fetchCompetitorContent,
  extractCompetitorNLP,
  type CompetitorNLP,
} from '@/lib/competitor'
import { marketLabel } from '@/lib/markets'

export interface SerpGapResult {
  contentGaps: string[]
  commonTopics: string[]
  entities: string[]
  weaknesses: string[]
  /** 0–100 — higher means more actionable gaps found */
  gapScore: number
  competitorCount: number
  serpFeatures: string[]
}

function scoreGaps(nlp: CompetitorNLP, competitorCount: number): number {
  const gapPoints = Math.min(40, nlp.contentGaps.length * 10)
  const weaknessPoints = Math.min(30, nlp.weaknesses.length * 8)
  const topicPoints = Math.min(20, nlp.commonTopics.length * 4)
  const coverageBonus = competitorCount >= 3 ? 10 : competitorCount >= 1 ? 5 : 0
  return Math.min(100, gapPoints + weaknessPoints + topicPoints + coverageBonus)
}

/** Infer SERP feature targets from gap analysis (FAQ/PAA-style opportunities). */
function inferSerpFeatures(nlp: CompetitorNLP): string[] {
  const features: string[] = []
  if (nlp.contentGaps.some(g => /\?|how|what|why|when|cost|price/i.test(g))) {
    features.push('People Also Ask')
  }
  if (nlp.commonTopics.length >= 4) features.push('Featured snippet')
  if (nlp.contentGaps.length >= 3) features.push('Comprehensive guide')
  return features
}

export async function analyzeSerpGap(keyword: string, market: string): Promise<SerpGapResult> {
  const empty: SerpGapResult = {
    contentGaps: [],
    commonTopics: [],
    entities: [],
    weaknesses: [],
    gapScore: 0,
    competitorCount: 0,
    serpFeatures: [],
  }

  try {
    const urls = await getTopCompetitorUrls(keyword, market)
    if (urls.length === 0) return empty

    const texts = (
      await Promise.all(urls.slice(0, 4).map(u => fetchCompetitorContent(u)))
    ).filter(t => t.length > 200)

    if (texts.length === 0) return { ...empty, competitorCount: urls.length }

    const nlp = await extractCompetitorNLP(texts, `${keyword} (${marketLabel(market)})`)

    return {
      contentGaps: nlp.contentGaps.slice(0, 8),
      commonTopics: nlp.commonTopics.slice(0, 8),
      entities: nlp.entities.slice(0, 10),
      weaknesses: nlp.weaknesses.slice(0, 6),
      gapScore: scoreGaps(nlp, texts.length),
      competitorCount: texts.length,
      serpFeatures: inferSerpFeatures(nlp),
    }
  } catch (err) {
    console.warn('[serp-gap-analyzer] failed:', err)
    return empty
  }
}

/** Merge user-selected keywords with cluster output — nothing selected gets dropped. */
export function mergeClusterKeywords(
  primaryKeyword: string,
  clusteredSecondary: string[],
  allSelected: string[]
): string[] {
  const primary = primaryKeyword.toLowerCase().trim()
  const merged = new Set<string>()
  for (const kw of clusteredSecondary) {
    const k = kw.trim()
    if (k && k.toLowerCase() !== primary) merged.add(k)
  }
  for (const kw of allSelected) {
    const k = kw.trim()
    if (k && k.toLowerCase() !== primary) merged.add(k)
  }
  return [...merged]
}

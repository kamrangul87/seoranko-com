// src/lib/keyword-cluster.ts
// Station 2 (Plan) — per §3, Plan produces one Page per CLUSTER, not one Page
// per keyword. This groups a small set of user-selected keywords (picked
// together in the Keywords screen because they target the same topic) into a
// single primary keyword + secondary keywords for one Brief/Write pass.
//
// Distinct from topical-map.ts's buildTopicalMap(), which clusters EXISTING
// published articles for internal-linking/authority analysis (a later-station
// concern) — this runs pre-write, on raw keyword strings, to produce exactly
// one page brief.

import Anthropic from '@anthropic-ai/sdk'
import { MODEL_FOR } from '@/lib/model-router'

const client = new Anthropic()

export interface KeywordClusterInput {
  keyword: string
  volume?: number | null
  intent?: string | null
}

export interface KeywordClusterResult {
  primaryKeyword: string
  secondaryKeywords: string[]
  intent: string | null
}

function fallbackCluster(keywords: KeywordClusterInput[]): KeywordClusterResult {
  const sorted = [...keywords].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
  return {
    primaryKeyword: sorted[0].keyword,
    secondaryKeywords: sorted.slice(1).map(k => k.keyword),
    intent: sorted[0].intent ?? null,
  }
}

export async function clusterKeywords(keywords: KeywordClusterInput[]): Promise<KeywordClusterResult> {
  if (keywords.length === 0) {
    return { primaryKeyword: '', secondaryKeywords: [], intent: null }
  }
  if (keywords.length === 1) {
    return { primaryKeyword: keywords[0].keyword, secondaryKeywords: [], intent: keywords[0].intent ?? null }
  }

  try {
    const list = keywords
      .map((k, i) => `${i + 1}. "${k.keyword}"${k.volume ? ` (volume: ${k.volume})` : ''}${k.intent ? ` [${k.intent}]` : ''}`)
      .join('\n')

    const response = await client.messages.create({
      model: MODEL_FOR.keywordCluster,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `These keywords were selected together to be covered by ONE article because they target the same topic/search intent. Pick the single best primary keyword to target (usually the highest-volume, most general phrase the others are close variations of), and list the rest as secondary keywords that article should naturally cover.

Keywords:
${list}

Respond ONLY with JSON in this exact format:
{"primaryKeyword": "the best one", "secondaryKeywords": ["the others"], "intent": "informational|commercial|transactional|navigational"}`,
      }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
    if (!parsed.primaryKeyword) return fallbackCluster(keywords)

    return {
      primaryKeyword: parsed.primaryKeyword,
      secondaryKeywords: Array.isArray(parsed.secondaryKeywords) ? parsed.secondaryKeywords : [],
      intent: parsed.intent ?? null,
    }
  } catch (err) {
    console.warn('[keyword-cluster] LLM clustering failed, falling back to volume-sort:', err)
    return fallbackCluster(keywords)
  }
}

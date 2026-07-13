// src/lib/rank-guard.ts
// Fires when rank drops 3+ positions
// Picks the weakest score dimension and runs a targeted improve pass

import { improveArticle } from './article-improver'
import { createClient } from '@supabase/supabase-js'

export interface RankDropEvent {
  articleId: string
  keyword: string
  previousPosition: number
  currentPosition: number
  drop: number
}

export interface ReoptimiseResult {
  articleId: string
  triggered: boolean
  reason: string
  improveTarget: string
  changesSummary?: string
}

function chooseImproveTarget(drop: number, scores: {
  eeat?: number
  readability?: number
  humanScore?: number
  factDensity?: number
}): string {
  if (drop >= 10) return 'all'

  const ranked = [
    { target: 'eeat',         score: scores.eeat || 70 },
    { target: 'readability',  score: scores.readability || 70 },
    { target: 'human_score',  score: scores.humanScore || 70 },
    { target: 'fact_sourcing', score: scores.factDensity || 70 }
  ].sort((a, b) => a.score - b.score)

  return ranked[0].target
}

export async function handleRankDrop(
  event: RankDropEvent,
  articleContent: string,
  articleTitle: string,
  currentScores: {
    eeat?: number
    readability?: number
    humanScore?: number
    factDensity?: number
  }
): Promise<ReoptimiseResult> {
  if (event.drop < 3) {
    return {
      articleId: event.articleId,
      triggered: false,
      reason: `Drop of ${event.drop} positions is below threshold`,
      improveTarget: 'none'
    }
  }

  const target = chooseImproveTarget(event.drop, currentScores)

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await improveArticle({
      articleContent,
      target: target as any,
      currentScore: Math.min(
        ...(Object.values(currentScores).filter(Boolean) as number[])
      ) || 65,
      keyword: event.keyword,
      title: articleTitle
    })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    await supabase
      .from('articles')
      .update({
        content: result.improvedContent,
        updated_at: new Date().toISOString(),
        last_reoptimised_at: new Date().toISOString(),
        reoptimise_reason: `Rank dropped from #${event.previousPosition} to #${event.currentPosition}`
      })
      .eq('id', event.articleId)

    await supabase
      .from('ranking_agent_articles')
      .update({ last_reoptimise_at: new Date().toISOString() })
      .eq('article_id', event.articleId)

    return {
      articleId: event.articleId,
      triggered: true,
      reason: `Dropped ${event.drop} positions (#${event.previousPosition} → #${event.currentPosition})`,
      improveTarget: target,
      changesSummary: result.changesSummary
    }
  } catch (err) {
    return {
      articleId: event.articleId,
      triggered: false,
      reason: `Reoptimise failed: ${String(err)}`,
      improveTarget: target
    }
  }
}

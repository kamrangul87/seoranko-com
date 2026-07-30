// src/lib/rank-guard.ts
// Picks the weakest score dimension and runs a targeted improve pass.
//
// §10 item 5: the fixed "drop >= 3" gate is replaced by evaluateTrigger()
// (src/lib/rank-trigger.ts) — a fitted slope, a band-dependent noise
// threshold, and two consecutive worsening checks. Callers should pass
// `history` so that decision can be made; `drop` alone cannot express it.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { improveArticle } from './article-improver'
import { createClient } from '@supabase/supabase-js'
import { evaluateTrigger, type RankObservation, type TriggerDecision } from './rank-trigger'
import { checkWashout, logPageTreatment } from './treatment-log'

export interface RankDropEvent {
  articleId: string
  keyword: string
  previousPosition: number
  currentPosition: number
  drop: number
  /** Full rank history for this unit. Required for a band-aware decision. */
  history?: RankObservation[]
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
  // §6.4 — decide from the trend, not a single delta against a fixed constant.
  const decision: TriggerDecision = event.history?.length
    ? evaluateTrigger(event.history)
    : {
        // No history supplied: refuse rather than fall back to the old
        // last-minus-first behaviour this item exists to remove.
        fired: false,
        reason: 'No rank history supplied — cannot assess whether this is a sustained decline or normal noise.',
        slope: null, band: null, consecutiveWorsening: 0, noiseThreshold: null, totalDrop: null
      }

  if (!decision.fired) {
    return {
      articleId: event.articleId,
      triggered: false,
      reason: decision.reason,
      improveTarget: 'none'
    }
  }

  const target = chooseImproveTarget(event.drop, currentScores)

  const supabaseEarly = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // §10 item 9 / §7.3 / §7.8: "one live treatment per unit, no exceptions."
  // The unit for washout purposes is the ranking_agent_articles row, not the
  // articles row the rest of this function updates.
  const { data: unit } = await supabaseEarly
    .from('ranking_agent_articles')
    .select('id, user_id')
    .eq('article_id', event.articleId)
    .maybeSingle()

  if (!unit?.id) {
    return {
      articleId: event.articleId,
      triggered: false,
      reason: 'Could not resolve the tracked unit for this article — washout cannot be verified, so no treatment was applied.',
      improveTarget: 'none'
    }
  }

  const washout = await checkWashout(supabaseEarly, unit.id)
  if (!washout.allowed) {
    return {
      articleId: event.articleId,
      triggered: false,
      reason: washout.reason,
      improveTarget: 'none'
    }
  }

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

    await supabaseEarly
      .from('articles')
      .update({
        content: result.improvedContent,
        updated_at: new Date().toISOString(),
        last_reoptimised_at: new Date().toISOString(),
        reoptimise_reason: `Rank dropped from #${event.previousPosition} to #${event.currentPosition}`
      })
      .eq('id', event.articleId)

    await supabaseEarly
      .from('ranking_agent_articles')
      .update({ last_reoptimise_at: new Date().toISOString() })
      .eq('article_id', event.articleId)

    // §10 item 9 — record the treatment. `legacyTarget` because the current
    // improveTarget vocabulary (eeat/readability/human_score/fact_sourcing/all)
    // doesn't map 1:1 onto §7.1's T01-T10 catalog yet (item 12, deferred).
    await logPageTreatment(supabaseEarly, {
      userId: unit.user_id,
      unitId: unit.id,
      legacyTarget: target,
      keyword: event.keyword,
      triggerReason: decision.reason,
      changesSummary: result.changesSummary
    })

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

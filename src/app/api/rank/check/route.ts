import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkKeywordRank } from '@/lib/rank-tracker'
import { logRankCheck } from '@/lib/rank-check-log'
import { evaluateTrigger, type RankObservation, type TriggerDecision } from '@/lib/rank-trigger'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const {
      keyword,
      articleUrl,
      articleId,
      previousPosition,
      locationCode: requestedLocation
    } = await req.json()

    if (!keyword || !articleUrl) {
      return NextResponse.json({ error: 'keyword and articleUrl required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // §10 item 3 — locale is a per-unit property, not a global default. The
    // article is TRACKED at a location_code; checking it at a different one
    // returns a different SERP and guarantees disagreement with ground truth.
    // This route defaulted to 2840 (US) while the weekly agent used 2826 (UK),
    // so the same keyword had two answers. Prefer the stored value.
    let ownerId: string | null = null
    let storedLocation: number | null = null
    if (articleId) {
      const { data: row } = await supabase
        .from('ranking_agent_articles')
        .select('user_id, location_code')
        .eq('id', articleId)
        .maybeSingle()
      ownerId = row?.user_id ?? null
      storedLocation = row?.location_code ?? null
    }

    const locationCode = storedLocation ?? requestedLocation ?? 2840
    const result = await checkKeywordRank(keyword, articleUrl, locationCode)

    // §10 item 10 / §6.4: negative Δposition = good. current − previous, so an
    // improvement (15 → 12) yields −3, a decline (12 → 15) yields +3.
    const change = previousPosition != null && result.position != null
      ? result.position - previousPosition
      : null

    // §6.4 / item 5 — evaluate the trigger against the full history including
    // this check, and log the real decision. The log is worthless for the day-8
    // review if trigger_fired is hardcoded.
    let decision: TriggerDecision | null = null
    if (articleId) {
      const { data: history } = await supabase
        .from('rank_history')
        .select('position, checked_at')
        .eq('ranking_article_id', articleId)
        .order('checked_at', { ascending: true })
        .limit(60)

      const observations: RankObservation[] = [
        ...(history || []).map((h: { position: number | null; checked_at: string }) => ({
          position: h.position,
          checkedAt: h.checked_at
        })),
        { position: result.position, checkedAt: result.checkedAt }
      ]
      decision = evaluateTrigger(observations)
    }

    await logRankCheck(supabase, {
      userId: ownerId,
      articleId: articleId ?? null,
      result,
      triggerFired: decision?.fired ?? false,
      triggerReason: decision?.reason ?? null,
      // Item 6 records what actually happened; auto-diagnose is dispatched below.
      actionTaken: decision?.fired ? 'diagnose-dispatched' : 'none'
    })

    if (articleId) {
      await supabase.from('rank_history').insert({
        ranking_article_id: articleId,
        keyword: result.keyword,
        position: result.position,
        previous_position: previousPosition || null,
        position_change: change,
        location_code: result.locationCode,
        location_name: result.locationName,
        top_competitor: result.topCompetitor,
        serp_features: result.serpFeatures,
        checked_at: result.checkedAt
      })

      await supabase
        .from('ranking_agent_articles')
        .update({
          current_position: result.position,
          previous_position: previousPosition || null,
          position_change: change,
          top_competitor: result.topCompetitor,
          last_rank_check: result.checkedAt
        })
        .eq('id', articleId)
    }

    // §6.4 — dispatch only when the band-aware trigger actually fired. The old
    // condition (any change at all, or merely being outside the top 20) fired on
    // normal noise, which is a large share of the current false triggers.
    if (articleId && decision?.fired) {
      fetch(`${req.nextUrl.origin}/api/rank/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword,
          currentPosition: result.position,
          previousPosition,
          positionChange: change,
          topCompetitor: result.topCompetitor,
          serpFeatures: result.serpFeatures,
          articleId
        })
      }).catch(() => {})
    }

    return NextResponse.json({ success: true, result, change })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

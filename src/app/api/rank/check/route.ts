import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkKeywordRank } from '@/lib/rank-tracker'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const {
      keyword,
      articleUrl,
      articleId,
      previousPosition,
      locationCode = 2840
    } = await req.json()

    if (!keyword || !articleUrl) {
      return NextResponse.json({ error: 'keyword and articleUrl required' }, { status: 400 })
    }

    const result = await checkKeywordRank(keyword, articleUrl, locationCode)

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const change = previousPosition != null && result.position != null
      ? previousPosition - result.position
      : null

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

    // Auto-diagnose if position changed or outside top 20 — fire and forget
    if (articleId && (change !== null || (result.position && result.position > 20))) {
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

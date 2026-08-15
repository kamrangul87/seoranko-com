import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkArticleCitation } from '@/lib/citation-tracker'
import {
  persistVelocityMetrics,
  recomputeFreshnessForTracked,
} from '@/lib/rank-monitor-pass'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const { keyword, articleUrl, articleId, locationCode: requestedLocation } = await req.json()
    if (!keyword || !articleUrl) {
      return NextResponse.json({ error: 'keyword and articleUrl required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    let locationCode = requestedLocation ?? 2840
    if (articleId) {
      const { data: row } = await supabase
        .from('ranking_agent_articles')
        .select('location_code')
        .eq('id', articleId)
        .maybeSingle()
      if (row?.location_code) locationCode = row.location_code
    }

    const result = await checkArticleCitation(keyword, articleUrl, { locationCode })

    let velocityUpdated = false
    let freshnessUpdated = false

    if (articleId) {
      await supabase
        .from('ranking_agent_articles')
        .update({
          perplexity_cited: result.isCited,
          cited_competitors: result.citedCompetitors,
          last_citation_check: result.checkedAt,
          citation_share_of_voice: result.shareOfVoice
        })
        .eq('id', articleId)

      velocityUpdated = await persistVelocityMetrics(supabase, articleId, keyword)
      freshnessUpdated = await recomputeFreshnessForTracked(supabase, articleId)
    }

    return NextResponse.json({
      success: true,
      result,
      velocityUpdated,
      freshnessUpdated,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { diagnoseRankingIssues } from '@/lib/ranking-intelligence'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const {
      keyword,
      currentPosition,
      previousPosition,
      positionChange,
      isCited,
      topCompetitor,
      articleId,
      rankScore = 70,
      eeatScore = 70,
      readabilityScore = 70,
      humanScore = 70,
      factScore = 70,
      daysSincePublish = 30,
      serpFeatures = []
    } = await req.json()

    const diagnosis = await diagnoseRankingIssues({
      keyword,
      currentPosition,
      previousPosition,
      positionChange,
      rankScore,
      eeatScore,
      readabilityScore,
      humanScore,
      factScore,
      daysSincePublish,
      isCited,
      topCompetitor,
      serpFeatures
    })

    if (articleId) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      await supabase
        .from('ranking_agent_articles')
        .update({
          last_diagnosis: diagnosis,
          last_diagnosed_at: new Date().toISOString()
        })
        .eq('id', articleId)
    }

    return NextResponse.json({ success: true, diagnosis })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

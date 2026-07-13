import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkArticleCitation } from '@/lib/citation-tracker'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const { keyword, articleUrl, articleId } = await req.json()
    if (!keyword || !articleUrl) return NextResponse.json({ error: 'keyword and articleUrl required' }, { status: 400 })

    const result = await checkArticleCitation(keyword, articleUrl)

    if (articleId) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      await supabase
        .from('ranking_agent_articles')
        .update({
          perplexity_cited: result.isCited,
          cited_competitors: result.citedCompetitors,
          last_citation_check: result.checkedAt,
          citation_share_of_voice: result.shareOfVoice
        })
        .eq('id', articleId)
    }

    return NextResponse.json({ success: true, result })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

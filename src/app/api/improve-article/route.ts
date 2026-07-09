import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { improveArticle, ImproveTarget } from '@/lib/article-improver'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const {
      articleId,
      articleContent,
      target,
      currentScore,
      keyword,
      title
    } = await req.json()

    if (!articleContent || !target || !keyword) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const result = await improveArticle({
      articleContent,
      target: target as ImproveTarget,
      currentScore: currentScore || 0,
      keyword,
      title: title || ''
    })

    if (articleId) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )

      const { data: existing } = await supabase
        .from('articles')
        .select('improve_history')
        .eq('id', articleId)
        .single()

      const history = Array.isArray(existing?.improve_history) ? existing.improve_history : []
      history.push({
        target,
        score_before: currentScore,
        changes: result.changesSummary,
        improved_at: new Date().toISOString()
      })

      await supabase
        .from('articles')
        .update({
          content: result.improvedContent,
          improve_history: history,
          updated_at: new Date().toISOString(),
        })
        .eq('id', articleId)
    }

    return NextResponse.json({
      success: true,
      improvedContent: result.improvedContent,
      changesSummary: result.changesSummary,
      estimatedScoreGain: result.estimatedScoreGain
    })

  } catch (error) {
    console.error('[improve-article]', error)
    return NextResponse.json(
      { error: 'Failed to improve article', details: String(error) },
      { status: 500 }
    )
  }
}

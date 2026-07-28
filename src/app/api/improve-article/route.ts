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
      title,
      instruction,
      autoApply
    } = await req.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Callers may pass the content directly (the Improve page pastes it), or
    // pass only an articleId and let us load it (RANKO's one-click fixes).
    let content = articleContent
    let resolvedKeyword = keyword
    let resolvedTitle = title

    if (!content && articleId) {
      const { data: article, error } = await supabase
        .from('articles')
        .select('content, keyword, title')
        .eq('id', articleId)
        .single()

      if (error || !article) {
        return NextResponse.json(
          { error: 'Article not found', details: error?.message },
          { status: 404 }
        )
      }

      content = article.content
      resolvedKeyword = resolvedKeyword || article.keyword
      resolvedTitle = resolvedTitle || article.title
    }

    // A free-text instruction supplies its own direction, so `target` is only
    // required for the canned improve passes.
    if (!content || (!target && !instruction)) {
      return NextResponse.json(
        { error: 'Missing required fields: need articleContent or articleId, plus target or instruction' },
        { status: 400 }
      )
    }

    const result = await improveArticle({
      articleContent: content,
      target: (target || 'all') as ImproveTarget,
      currentScore: currentScore || 0,
      keyword: resolvedKeyword || '',
      title: resolvedTitle || '',
      instruction
    })

    // Only persist when the caller asked for it. autoApply defaults to true for
    // legacy callers that pass an articleId and expect the old save behaviour.
    const shouldSave = articleId && (autoApply ?? true)

    if (shouldSave) {
      const { data: existing } = await supabase
        .from('articles')
        .select('improve_history')
        .eq('id', articleId)
        .single()

      const history = Array.isArray(existing?.improve_history) ? existing.improve_history : []
      history.push({
        target: instruction ? 'targeted-fix' : target,
        instruction: instruction || null,
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
      applied: Boolean(shouldSave),
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

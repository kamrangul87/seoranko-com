import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { improveArticle, ImproveTarget } from '@/lib/article-improver'
import { checkContentIdentity } from '@/lib/content-identity-guard'
import { getBrandSettings } from '@/lib/brand-settings'
import {
  resolveLogoPolicy,
  expectOrganizationLogoFromPolicy,
} from '@/lib/quality-gate-policy'

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
      autoApply,
      brand: rawBrand
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
    let resolvedBrand = rawBrand
    let userId: string | undefined

    try {
      const cookieStore = cookies()
      const authClient = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { get(name: string) { return cookieStore.get(name)?.value } } },
      )
      const { data: { user } } = await authClient.auth.getUser()
      userId = user?.id
    } catch (authErr) {
      console.warn('[improve-article] auth lookup failed, continuing with omit logo policy:', authErr)
    }

    if (!content && articleId) {
      const { data: article, error } = await supabase
        .from('articles')
        .select('content, keyword, title, brand, user_id')
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
      resolvedBrand = resolvedBrand || article.brand
      if (!userId && article.user_id) userId = article.user_id
    }

    // A free-text instruction supplies its own direction, so `target` is only
    // required for the canned improve passes.
    if (!content || (!target && !instruction)) {
      return NextResponse.json(
        { error: 'Missing required fields: need articleContent or articleId, plus target or instruction' },
        { status: 400 }
      )
    }

    let brandSettings = { configured: false, logoUrl: null as string | null }
    try {
      brandSettings = (userId && resolvedBrand)
        ? await getBrandSettings(userId, resolvedBrand)
        : { configured: false, logoUrl: null }
    } catch (err) {
      console.warn('[improve-article] getBrandSettings failed:', err)
    }
    const expectOrganizationLogo = expectOrganizationLogoFromPolicy(
      resolveLogoPolicy({ brandSettings }),
    )

    const result = await improveArticle({
      articleContent: content,
      target: (target || 'all') as ImproveTarget,
      currentScore: currentScore || 0,
      keyword: resolvedKeyword || '',
      title: resolvedTitle || '',
      instruction,
      brand: resolvedBrand || undefined,
      expectOrganizationLogo,
    })

    // Content identity guard — an "edit" that comes back as a different
    // document must never reach the database.
    const identityCheck = checkContentIdentity(
      content,
      resolvedTitle || null,
      result.improvedContent,
      resolvedTitle || null
    )

    if (!identityCheck.isSameDocument) {
      console.error('[improve-article] identity guard blocked save', {
        articleId,
        similarityScore: identityCheck.similarityScore
      })
      // 200, not 500 — an expected guard outcome, not a server error.
      return NextResponse.json({
        blocked: true,
        warning: identityCheck.warning,
        similarityScore: identityCheck.similarityScore
      }, { status: 200 })
    }

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
      estimatedScoreGain: result.estimatedScoreGain,
      // Non-null when this was a heavy rewrite that passed but deserves a look
      warning: identityCheck.warning,
      similarityScore: identityCheck.similarityScore
    })

  } catch (error) {
    console.error('[improve-article]', error)
    return NextResponse.json(
      { error: 'Failed to improve article', details: String(error) },
      { status: 500 }
    )
  }
}

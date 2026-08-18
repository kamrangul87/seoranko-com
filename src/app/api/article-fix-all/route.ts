import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { fixAllArticleIssues } from '@/lib/article-fix-all'
import { checkContentIdentity } from '@/lib/content-identity-guard'
import { getBrandSettings } from '@/lib/brand-settings'
import {
  resolveLogoPolicy,
  expectOrganizationLogoFromPolicy,
} from '@/lib/quality-gate-policy'

export const maxDuration = 120

/**
 * POST /api/article-fix-all
 * Runs every available auto-fix for the article's current Quality Gate
 * issues, re-checks the gate, and returns an honest fixed/remaining report.
 */
export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get(name: string) { return cookieStore.get(name)?.value } } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
      articleHtml,
      keyword = '',
      brand = '',
      domain = '',
      targetWordCount = 2000,
      articleId,
      save = false,
    } = body

    if (!articleHtml || typeof articleHtml !== 'string') {
      return NextResponse.json({ error: 'articleHtml is required' }, { status: 400 })
    }
    if (!keyword || typeof keyword !== 'string') {
      return NextResponse.json({ error: 'keyword is required' }, { status: 400 })
    }

    const registeredLinkDomains = domain
      ? [String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()]
      : []

    let brandSettings = { configured: false, logoUrl: null as string | null }
    try {
      brandSettings = brand
        ? await getBrandSettings(user.id, brand)
        : { configured: false, logoUrl: null }
    } catch (err) {
      console.warn('[article-fix-all] getBrandSettings failed:', err)
    }
    const expectOrganizationLogo = expectOrganizationLogoFromPolicy(
      resolveLogoPolicy({ brandSettings }),
    )

    const result = await fixAllArticleIssues({
      html: articleHtml,
      keyword,
      brand: brand || '',
      registeredLinkDomains,
      targetWordCount: Number(targetWordCount) || 2000,
      userId: user.id,
      articleId,
      expectOrganizationLogo,
    })

    const identity = checkContentIdentity(articleHtml, null, result.html, null)
    if (!identity.isSameDocument) {
      return NextResponse.json({
        blocked: true,
        warning: identity.warning || 'Fix All produced content that no longer matches this article',
        similarityScore: identity.similarityScore,
      }, { status: 200 })
    }

    if (save && articleId) {
      const { error } = await supabase
        .from('articles')
        .update({
          content: result.html,
          quality_score: result.qualityGateAfter.score,
          quality_passed: result.qualityGateAfter.passed,
          quality_issues: result.qualityGateAfter.issues,
          quality_auto_fixed: result.qualityGateAfter.autoFixedCount,
          quality_ready_to_publish: result.qualityGateAfter.readyToPublish,
          quality_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', articleId)
        .eq('user_id', user.id)
      if (error) {
        console.warn('[article-fix-all] save failed:', error.message)
      }
    }

    return NextResponse.json({
      html: result.html,
      qualityGate: result.qualityGateAfter,
      qualityGateBefore: {
        score: result.qualityGateBefore.score,
        criticalCount: result.qualityGateBefore.criticalCount,
        warningCount: result.qualityGateBefore.warningCount,
      },
      fixed: result.fixed,
      stillNeedsManualReview: result.stillNeedsManualReview,
      summary: result.summary,
    })
  } catch (err) {
    console.error('[article-fix-all]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Fix All failed' },
      { status: 500 }
    )
  }
}

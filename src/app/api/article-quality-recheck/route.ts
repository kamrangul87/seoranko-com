import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { runQualityGate } from '@/lib/article-quality-gate'
import { wordCountBand } from '@/lib/word-count'
import { getBrandSettings } from '@/lib/brand-settings'
import {
  resolveLogoPolicy,
  expectOrganizationLogoFromPolicy,
} from '@/lib/quality-gate-policy'
import { computePanelScores } from '@/lib/panel-scores'

export const maxDuration = 60

/** Re-run Quality Gate on current (possibly manually edited) HTML. */
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
      applyAutoFixes = false,
    } = body

    if (!articleHtml || !keyword) {
      return NextResponse.json({ error: 'articleHtml and keyword are required' }, { status: 400 })
    }

    const band = wordCountBand(Number(targetWordCount) || 2000)
    const registeredLinkDomains = domain
      ? [String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()]
      : []

    let brandSettings = { configured: false, logoUrl: null as string | null }
    try {
      brandSettings = brand
        ? await getBrandSettings(user.id, brand)
        : { configured: false, logoUrl: null }
    } catch (err) {
      console.warn('[article-quality-recheck] getBrandSettings failed:', err)
    }
    const expectOrganizationLogo = expectOrganizationLogoFromPolicy(
      resolveLogoPolicy({ brandSettings }),
    )

    const qr = await runQualityGate(articleHtml, {
      brand: brand || '',
      keyword,
      authorName: 'Kamran Gul',
      registeredLinkDomains,
      minWordCount: band.min,
      maxWordCount: band.max,
      userId: user.id,
      expectOrganizationLogo,
    })

    const html = applyAutoFixes ? (qr.articleAfterAutoFix || articleHtml) : articleHtml
    const panelScores = computePanelScores(html, keyword)

    return NextResponse.json({
      html,
      qualityGate: {
        passed: qr.passed,
        score: qr.score,
        criticalCount: qr.criticalCount,
        warningCount: qr.warningCount,
        autoFixedCount: applyAutoFixes ? qr.autoFixedCount : 0,
        issues: qr.issues,
        blockers: qr.blockers,
        readyToPublish: qr.readyToPublish,
      },
      panelScores,
      eeatScore: panelScores.eeatScore,
      readabilityScore: panelScores.readabilityScore,
      keywordDensity: panelScores.keywordDensity,
      keywordDensityScore: panelScores.keywordDensityScore,
    })
  } catch (err) {
    console.error('[article-quality-recheck]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Recheck failed' },
      { status: 500 }
    )
  }
}

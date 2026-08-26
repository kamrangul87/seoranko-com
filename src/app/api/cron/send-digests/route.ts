import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildDigestHTML, computeTopAction } from '@/lib/digest-email'
import type { DigestArticle } from '@/lib/digest-email'
import { generateWeeklySummary } from '@/lib/ranking-intelligence'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: users } = await supabase
    .from('profiles')
    .select('id, full_name, email, digest_enabled')
    .eq('digest_enabled', true)

  if (!users?.length) return NextResponse.json({ sent: 0 })

  let sent = 0

  for (const user of users) {
    const { data: tracked } = await supabase
      .from('ranking_agent_articles')
      .select(`
        id, title, keyword, freshness_status, needs_refresh,
        perplexity_cited, cited_competitors, last_refresh_at,
        articles (rank_score, created_at)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(15)

    if (!tracked?.length) continue

    // C04 — claims flagged by the weekly temporal-claims freshness check
    // (source URL no longer resolves). Review only, never surfaced as if
    // auto-resolved.
    const { data: flaggedClaims } = await supabase
      .from('temporal_claims')
      .select('article_id, claim_text, source_url')
      .eq('user_id', user.id)
      .eq('status', 'flagged')
      .order('detected_at', { ascending: false })
      .limit(5)
    const temporalClaimDrift = (flaggedClaims || []).map(c => ({
      articleId: c.article_id,
      claimText: c.claim_text,
      sourceUrl: c.source_url,
      reason: 'source page no longer resolves',
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const articles: DigestArticle[] = tracked.map((t: any) => ({
      title: t.title || t.keyword,
      keyword: t.keyword,
      rankScore: t.articles?.rank_score || 0,
      rankChange: null,
      currentPosition: t.current_position || null,
      positionChange: t.position_change || null,
      locationCode: t.location_code || 2840,
      isCited: t.perplexity_cited,
      citedCompetitors: t.cited_competitors || [],
      freshnessStatus: t.freshness_status || 'fresh',
      needsRefresh: t.needs_refresh || false,
      topAction: ''
    }))

    const topAction = computeTopAction(articles)

    // AI-generated weekly summary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const articleContexts = articles.map((a: any) => ({
      keyword: a.keyword,
      currentPosition: a.currentPosition || null,
      previousPosition: a.positionChange !== null && a.currentPosition !== null
        ? a.currentPosition - (a.positionChange || 0) : null,
      positionChange: a.positionChange || null,
      rankScore: a.rankScore || 0,
      eeatScore: 70,
      readabilityScore: 70,
      humanScore: 70,
      factScore: 70,
      daysSincePublish: 30,
      isCited: a.isCited,
      topCompetitor: null,
      serpFeatures: []
    }))
    const weeklySummary = await generateWeeklySummary(articleContexts).catch(() => '')

    const freshnessSummary = {
      fresh: articles.filter(a => a.freshnessStatus === 'fresh').length,
      aging: articles.filter(a => a.freshnessStatus === 'aging').length,
      stale: articles.filter(a => ['stale', 'very-stale'].includes(a.freshnessStatus)).length
    }
    const citationSummary = {
      cited: articles.filter(a => a.isCited === true).length,
      notCited: articles.filter(a => a.isCited === false).length,
      unchecked: articles.filter(a => a.isCited === null).length
    }

    const html = buildDigestHTML({
      userName: user.full_name || 'there',
      userEmail: user.email,
      weekEnding: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      articles,
      topAction,
      freshnessSummary,
      citationSummary,
      weeklySummary: weeklySummary || undefined,
      temporalClaimDrift: temporalClaimDrift.length > 0 ? temporalClaimDrift : undefined
    })

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'SEORANKO Weekly <digest@seoranko.com>',
        to: user.email,
        subject: `Your SEORANKO Weekly: ${citationSummary.cited} articles cited by AI · ${freshnessSummary.stale} need refreshing`,
        html
      })
    })

    sent++
  }

  return NextResponse.json({ success: true, sent })
}

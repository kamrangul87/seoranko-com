import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkBatchRanks } from '@/lib/rank-tracker'
import { handleRankDrop } from '@/lib/rank-guard'
import { runWeeklyFreshnessJobs } from '@/lib/freshness-automation'
import { runTemporalClaimsFreshnessCheck } from '@/lib/temporal-claims-freshness'
import { checkArticleCitation } from '@/lib/citation-tracker'
import {
  persistVelocityMetrics,
  recomputeFreshnessForTracked,
} from '@/lib/rank-monitor-pass'

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

  const results = {
    rankChecks: 0,
    rankDrops: 0,
    reoptimised: 0,
    citationChecks: 0,
    freshnessRefreshes: 0,
    temporalClaimsChecked: 0,
    temporalClaimsDrifted: 0,
    errors: [] as string[]
  }

  try {
    // Step 1: get all tracked articles
    const { data: tracked } = await supabase
      .from('ranking_agent_articles')
      .select(`
        id, keyword, article_url, current_position,
        location_code, user_id, title, last_citation_check,
        articles (
          id, content, rank_score, fact_density_score,
          eeat_score, readability_score, human_score, created_at
        )
      `)
      .limit(50)

    if (!tracked?.length) {
      return NextResponse.json({ success: true, message: 'No tracked articles', ...results })
    }

    // Step 2: batch rank check
    const rankInputs = tracked.map(a => ({
      keyword: a.keyword,
      url: a.article_url,
      previousPosition: a.current_position,
      locationCode: a.location_code || 2840
    }))

    const rankResults = await checkBatchRanks(rankInputs)
    results.rankChecks = rankResults.length

    // Step 3: save results + trigger re-optimise on drops
    for (let i = 0; i < rankResults.length; i++) {
      const rank = rankResults[i]
      const article_record = tracked[i]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const article = article_record.articles as any

      const prevPos = article_record.current_position
      const newPos = rank.position
      // §10 item 10 / §6.4: negative Δposition = good (current − previous).
      const change = prevPos != null && newPos != null ? newPos - prevPos : null

      // Save to rank history
      await supabase.from('rank_history').insert({
        ranking_article_id: article_record.id,
        user_id: article_record.user_id,
        keyword: rank.keyword,
        position: newPos,
        previous_position: prevPos,
        position_change: change,
        location_code: rank.locationCode,
        location_name: rank.locationName,
        top_competitor: rank.topCompetitor,
        serp_features: rank.serpFeatures,
        checked_at: rank.checkedAt
      })

      // Update current position on tracking record
      await supabase
        .from('ranking_agent_articles')
        .update({
          current_position: newPos,
          previous_position: prevPos,
          position_change: change,
          top_competitor: rank.topCompetitor,
          last_rank_check: rank.checkedAt
        })
        .eq('id', article_record.id)

      await persistVelocityMetrics(supabase, article_record.id, rank.keyword)
      await recomputeFreshnessForTracked(supabase, article_record.id)

      // §10 item 5/10 — this was the fixed "drop >= 3" gate that item 5 replaced
      // inside handleRankDrop() with a band-aware fitted-slope trigger. But this
      // is the ONLY production caller of handleRankDrop (the weekly cron), and
      // it never passed `history` — so evaluateTrigger always saw an empty
      // array and refused every time, silently turning auto-reoptimise into a
      // permanent no-op. Fetching the real history here is what makes item 5's
      // trigger fix actually take effect. The old naive `change <= -3` pre-filter
      // is removed in favour of letting the internal trigger decide.
      if (article?.content) {
        const { data: unitHistory } = await supabase
          .from('rank_history')
          .select('position, checked_at')
          .eq('ranking_article_id', article_record.id)
          .order('checked_at', { ascending: true })
          .limit(60)

        const reopt = await handleRankDrop(
          {
            articleId: article.id,
            keyword: rank.keyword,
            previousPosition: prevPos!,
            currentPosition: newPos!,
            drop: change != null ? Math.abs(change) : 0,
            history: (unitHistory || [])
              .filter((h: { position: number | null }) => h.position != null)
              .map((h: { position: number | null; checked_at: string }) => ({
                position: h.position,
                checkedAt: h.checked_at
              }))
          },
          article.content,
          article_record.title || rank.keyword,
          {
            eeat: article.eeat_score,
            readability: article.readability_score,
            humanScore: article.human_score,
            factDensity: article.fact_density_score
          }
        )
        if (reopt.triggered) {
          results.rankDrops++
          results.reoptimised++
        }
      }
    }

    // Step 4: citation checks — max 10 per week to control Perplexity API costs
    const citationDue = tracked
      .filter(a => {
        if (!a.last_citation_check) return true
        const days = (Date.now() - new Date(a.last_citation_check).getTime()) / 86400000
        return days >= 7
      })
      .slice(0, 10)

    for (const a of citationDue) {
      try {
        const loc = a.location_code || 2840
        const cit = await checkArticleCitation(a.keyword, a.article_url, { locationCode: loc })
        await supabase
          .from('ranking_agent_articles')
          .update({
            perplexity_cited: cit.isCited,
            cited_competitors: cit.citedCompetitors,
            citation_share_of_voice: cit.shareOfVoice,
            last_citation_check: cit.checkedAt
          })
          .eq('id', a.id)
        results.citationChecks++
      } catch (err) {
        results.errors.push(`Citation failed: ${a.keyword} — ${String(err)}`)
      }
    }

    // Step 5: freshness refresh
    const fresh = await runWeeklyFreshnessJobs()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    results.freshnessRefreshes = (fresh as any).refreshed || 0

    // Step 6: temporal-claims freshness check (C04) — re-verify cited
    // source URLs still resolve. Never rewrites articles; drift feeds the
    // weekly digest via the flagged status set on temporal_claims rows.
    try {
      const temporalFreshness = await runTemporalClaimsFreshnessCheck(supabase)
      results.temporalClaimsChecked = temporalFreshness.checked
      results.temporalClaimsDrifted = temporalFreshness.drift.length
      if (temporalFreshness.drift.length > 0) {
        console.log(`[weekly-jobs] temporal-claims drift: ${temporalFreshness.drift.length} claim(s) flagged`, temporalFreshness.drift)
      }
    } catch (err) {
      results.errors.push(`Temporal-claims freshness check failed: ${String(err)}`)
    }

    // Step 7: AI Visibility weekly citation checks (OpenAI + Perplexity)
    try {
      const { data: sites } = await supabase
        .from('connected_sites')
        .select('id, user_id')
        .limit(30)
      const { runCitationCheck } = await import('@/lib/ai-visibility/run-citation-check')
      let aiVisRuns = 0
      for (const s of sites || []) {
        try {
          const r = await runCitationCheck({
            supabase,
            userId: s.user_id,
            siteId: s.id,
            trigger: 'weekly_cron',
          })
          if (r.ok) aiVisRuns++
        } catch (err) {
          results.errors.push(`AI Visibility site ${s.id}: ${String(err)}`)
        }
      }
      ;(results as { aiVisibilityRuns?: number }).aiVisibilityRuns = aiVisRuns
    } catch (err) {
      results.errors.push(`AI Visibility weekly check failed: ${String(err)}`)
    }

  } catch (err) {
    results.errors.push(String(err))
  }

  return NextResponse.json({ success: true, ...results })
}

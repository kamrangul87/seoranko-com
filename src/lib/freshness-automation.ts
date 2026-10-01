// src/lib/freshness-automation.ts
// Auto-refresh logic for Ranking Agent weekly job

import { createClient } from '@supabase/supabase-js'
import { improveArticle } from './article-improver'
import { decayMonitoringEligible } from './rank-warming-up'

export interface FreshnessRefreshResult {
  articleId: string
  keyword: string
  daysSincePublish: number
  refreshApplied: boolean
  changes: string
  newContent?: string
}

export async function runFreshnessRefreshPass(
  articleId: string,
  articleContent: string,
  keyword: string,
  title: string,
  publishDate: string
): Promise<FreshnessRefreshResult> {
  const days = Math.floor((Date.now() - new Date(publishDate).getTime()) / 86400000)

  if (days < 88) {
    return { articleId, keyword, daysSincePublish: days, refreshApplied: false, changes: 'Not due for refresh yet' }
  }

  const refreshTarget = days >= 180 ? 'fact_sourcing' : 'eeat'

  const result = await improveArticle({
    articleContent,
    target: refreshTarget,
    currentScore: 70,
    keyword,
    title
  })

  const now = new Date().toISOString().split('T')[0]
  const refreshedContent = result.improvedContent
    .replace(/"dateModified"\s*:\s*"\d{4}-\d{2}-\d{2}"/, `"dateModified": "${now}"`)
    .replace(/Last updated:\s*\w+ \d{4}/i, `Last updated: ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`)
    .replace(/Fact-checked:\s*\w+ \d{4}/i, `Fact-checked: ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`)

  return {
    articleId,
    keyword,
    daysSincePublish: days,
    refreshApplied: true,
    changes: result.changesSummary,
    newContent: refreshedContent
  }
}

// Weekly job runner — called by Vercel cron
export async function runWeeklyFreshnessJobs() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 88)

  // Live schema has last_reoptimise_at — not last_refresh_at. Filtering on a
  // missing column returns { data: null, error } which used to look like
  // "nothing due" ({ processed: 0 }).
  const refreshCutoff = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data: dueArticles, error: dueError } = await supabase
    .from('ranking_agent_articles')
    .select('id, article_id, keyword, title')
    .lt('created_at', cutoff.toISOString())
    .or(
      `last_reoptimise_at.is.null,last_reoptimise_at.lt.${refreshCutoff}`,
    )
    .limit(20)

  if (dueError) {
    console.error('[freshness] due-articles query failed:', dueError.message)
    return { processed: 0, error: dueError.message }
  }

  if (!dueArticles?.length) return { processed: 0 }

  const results = []
  for (const tracked of dueArticles) {
    const { data: article, error: articleErr } = await supabase
      .from('articles')
      .select('content, keyword, created_at')
      .eq('id', tracked.article_id)
      .single()

    if (articleErr || !article) {
      console.error(
        `[freshness] article ${tracked.article_id} load failed:`,
        articleErr?.message || 'not found',
      )
      continue
    }

    // Content-decay monitoring only begins once a hosted publication is
    // LIVE_VERIFIED (Step 5). Only applies when this article actually has
    // a hosted publications row — CMS-tracked or manually-tracked articles
    // (no hosted row at all) are unaffected, matching existing behavior.
    const { data: hostedPub, error: hostedErr } = await supabase
      .from('publications')
      .select('state')
      .eq('article_id', tracked.article_id)
      .eq('destination', 'hosted')
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (hostedErr) {
      console.error(
        `[freshness] publications lookup failed for ${tracked.article_id}:`,
        hostedErr.message,
      )
      continue
    }
    if (hostedPub && !decayMonitoringEligible(hostedPub.state)) {
      console.log(`[freshness] skipping ${tracked.article_id} — hosted publication not yet LIVE_VERIFIED (${hostedPub.state})`)
      continue
    }

    try {
      const refreshResult = await runFreshnessRefreshPass(
        tracked.article_id,
        article.content,
        article.keyword,
        tracked.title || article.keyword,
        article.created_at
      )

      if (refreshResult.refreshApplied && refreshResult.newContent) {
        // articles has no freshness_status column in live schema — only content.
        const { error: artUpdErr } = await supabase
          .from('articles')
          .update({
            content: refreshResult.newContent,
            updated_at: new Date().toISOString(),
          })
          .eq('id', tracked.article_id)
        if (artUpdErr) {
          console.error(
            `[freshness] articles update failed for ${tracked.article_id}:`,
            artUpdErr.message,
          )
          continue
        }

        const { error: trackUpdErr } = await supabase
          .from('ranking_agent_articles')
          .update({
            last_reoptimise_at: new Date().toISOString(),
            freshness_status: 'fresh',
            needs_refresh: false,
          })
          .eq('id', tracked.id)
        if (trackUpdErr) {
          console.error(
            `[freshness] ranking_agent_articles update failed for ${tracked.id}:`,
            trackUpdErr.message,
          )
          continue
        }
      }

      results.push(refreshResult)
    } catch (err) {
      console.error(`Freshness refresh failed for article ${tracked.article_id}:`, err)
    }
  }

  return { processed: results.length, refreshed: results.filter(r => r.refreshApplied).length }
}

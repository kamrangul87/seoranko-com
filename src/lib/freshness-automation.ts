// src/lib/freshness-automation.ts
// Auto-refresh logic for Ranking Agent weekly job

import { createClient } from '@supabase/supabase-js'
import { improveArticle } from './article-improver'

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

  const { data: dueArticles } = await supabase
    .from('ranking_agent_articles')
    .select('id, article_id, keyword, title')
    .lt('created_at', cutoff.toISOString())
    .or('last_refresh_at.is.null,last_refresh_at.lt.' + new Date(Date.now() - 30 * 86400000).toISOString())
    .limit(20)

  if (!dueArticles?.length) return { processed: 0 }

  const results = []
  for (const tracked of dueArticles) {
    const { data: article } = await supabase
      .from('articles')
      .select('content, keyword, created_at')
      .eq('id', tracked.article_id)
      .single()

    if (!article) continue

    try {
      const refreshResult = await runFreshnessRefreshPass(
        tracked.article_id,
        article.content,
        article.keyword,
        tracked.title || article.keyword,
        article.created_at
      )

      if (refreshResult.refreshApplied && refreshResult.newContent) {
        await supabase
          .from('articles')
          .update({
            content: refreshResult.newContent,
            freshness_status: 'fresh',
            updated_at: new Date().toISOString()
          })
          .eq('id', tracked.article_id)

        await supabase
          .from('ranking_agent_articles')
          .update({
            last_refresh_at: new Date().toISOString(),
            freshness_status: 'fresh',
            needs_refresh: false
          })
          .eq('id', tracked.id)
      }

      results.push(refreshResult)
    } catch (err) {
      console.error(`Freshness refresh failed for article ${tracked.article_id}:`, err)
    }
  }

  return { processed: results.length, refreshed: results.filter(r => r.refreshApplied).length }
}

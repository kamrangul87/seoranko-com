// src/lib/recurring-issue-detector.ts
// Checks whether a Quality Gate issue category has appeared in 3+ of the
// user's last 5 generation runs — if so, it's a pipeline/prompt bug, not a
// one-off content fluke, and the user shouldn't have to rediscover it
// article after article.

import { SupabaseClient } from '@supabase/supabase-js'

export interface RecurringIssueAlert {
  category: string
  occurrences: number
  outOfLastN: number
  message: string
}

export async function detectRecurringIssues(
  supabase: SupabaseClient,
  userId: string
): Promise<RecurringIssueAlert[]> {

  // Get the last 5 distinct articles that had any quality gate issues
  const { data: recentLogs } = await supabase
    .from('quality_gate_history')
    .select('article_id, issue_category, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)  // enough rows to cover ~5 articles worth of issues

  if (!recentLogs || recentLogs.length === 0) return []

  const recentArticleIds = Array.from(new Set(recentLogs.map(l => l.article_id))).slice(0, 5)
  const relevantLogs = recentLogs.filter(l => recentArticleIds.includes(l.article_id))

  const categoryToArticles: Record<string, Set<string>> = {}
  for (const log of relevantLogs) {
    if (!categoryToArticles[log.issue_category]) categoryToArticles[log.issue_category] = new Set()
    categoryToArticles[log.issue_category].add(log.article_id)
  }

  const alerts: RecurringIssueAlert[] = []
  for (const [category, articleSet] of Object.entries(categoryToArticles)) {
    if (articleSet.size >= 3) {
      alerts.push({
        category,
        occurrences: articleSet.size,
        outOfLastN: recentArticleIds.length,
        message: `"${category}" has appeared in ${articleSet.size} of your last ${recentArticleIds.length} articles — this looks like a generation pipeline issue, not a one-off content mistake. Consider reporting this so the underlying prompt can be fixed.`
      })
    }
  }

  return alerts
}

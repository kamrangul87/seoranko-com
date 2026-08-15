// Post-rank-check monitor pass — citation, velocity, freshness for one tracked row.

import type { SupabaseClient } from '@supabase/supabase-js'
import { checkArticleCitation } from '@/lib/citation-tracker'
import { predictRankingVelocity } from '@/lib/velocity-predictor'
import { scoreContentFreshness } from '@/lib/aeo-signals'

export interface MonitorPassResult {
  citationChecked: boolean
  citationError?: string
  velocityUpdated: boolean
  freshnessUpdated: boolean
}

export async function persistVelocityMetrics(
  supabase: SupabaseClient,
  articleId: string,
  keyword: string
): Promise<boolean> {
  try {
    const prediction = await predictRankingVelocity(articleId, keyword, 10)
    const { error } = await supabase
      .from('ranking_agent_articles')
      .update({
        weekly_velocity: prediction.weeklyVelocity,
        predicted_weeks_to_page1: prediction.predictedWeeksToTarget,
      })
      .eq('id', articleId)
    return !error
  } catch (err) {
    console.warn('[rank-monitor-pass] velocity persist failed:', err)
    return false
  }
}

export async function recomputeFreshnessForTracked(
  supabase: SupabaseClient,
  articleId: string
): Promise<boolean> {
  try {
    const { data: row } = await supabase
      .from('ranking_agent_articles')
      .select('created_at, last_refresh_at, articles ( created_at )')
      .eq('id', articleId)
      .maybeSingle()

    if (!row) return false

    const linked = row.articles as { created_at?: string } | null
    const publishDate =
      linked?.created_at ??
      row.last_refresh_at ??
      row.created_at ??
      new Date().toISOString()

    const fresh = scoreContentFreshness(publishDate)
    const needsRefresh = fresh.status === 'stale' || fresh.status === 'very-stale'

    const { error } = await supabase
      .from('ranking_agent_articles')
      .update({
        freshness_status: fresh.status,
        needs_refresh: needsRefresh,
        refresh_reason: needsRefresh ? fresh.aeoImpact : null,
      })
      .eq('id', articleId)

    return !error
  } catch (err) {
    console.warn('[rank-monitor-pass] freshness recompute failed:', err)
    return false
  }
}

export async function runCitationCheckForTracked(
  supabase: SupabaseClient,
  articleId: string,
  keyword: string,
  articleUrl: string,
  locationCode?: number
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await checkArticleCitation(keyword, articleUrl, { locationCode })
    const { error } = await supabase
      .from('ranking_agent_articles')
      .update({
        perplexity_cited: result.isCited,
        cited_competitors: result.citedCompetitors,
        last_citation_check: result.checkedAt,
        citation_share_of_voice: result.shareOfVoice,
      })
      .eq('id', articleId)

    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** Full monitor pass after a rank check — citation + velocity + freshness. */
export async function runMonitorPassForArticle(
  supabase: SupabaseClient,
  articleId: string,
  keyword: string,
  articleUrl: string,
  locationCode?: number
): Promise<MonitorPassResult> {
  const citation = await runCitationCheckForTracked(
    supabase,
    articleId,
    keyword,
    articleUrl,
    locationCode
  )
  const velocityUpdated = await persistVelocityMetrics(supabase, articleId, keyword)
  const freshnessUpdated = await recomputeFreshnessForTracked(supabase, articleId)

  return {
    citationChecked: citation.ok,
    citationError: citation.error,
    velocityUpdated,
    freshnessUpdated,
  }
}

/** Try to link a tracked URL to a saved SEORANKO article row (for ROI + auto-fix). */
export async function findLinkedArticleId(
  supabase: SupabaseClient,
  userId: string,
  articleUrl: string
): Promise<string | null> {
  const normalized = normalizeTrackUrl(articleUrl)
  if (!normalized) return null

  const { data: rows } = await supabase
    .from('articles')
    .select('id, article_url')
    .eq('user_id', userId)
    .not('article_url', 'is', null)
    .limit(100)

  for (const row of rows ?? []) {
    if (!row.article_url) continue
    if (normalizeTrackUrl(row.article_url) === normalized) return row.id
  }

  // Path-only fallback — same slug on user's domain
  const path = tryPath(normalized)
  if (path) {
    for (const row of rows ?? []) {
      if (row.article_url && tryPath(normalizeTrackUrl(row.article_url)!) === path) {
        return row.id
      }
    }
  }

  return null
}

function normalizeTrackUrl(url: string): string | null {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`.toLowerCase()
  } catch {
    return null
  }
}

function tryPath(normalized: string): string | null {
  const slash = normalized.indexOf('/')
  return slash >= 0 ? normalized.slice(slash) : null
}

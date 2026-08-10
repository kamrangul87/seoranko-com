/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/article-publisher.ts
// Orchestrates a real publish: looks up the site connection and article
// exactly the way applySiteAutoFix (site-autofix.ts) does, drives the
// pages row through the liveness state machine, and calls the right
// PublisherAdapter. Deliberately mirrors that file's shape — same
// credential-lookup pattern, same "look up site → look up connection →
// call platform-agnostic lib function → return typed result" structure —
// so anyone who already knows that code path recognises this one.
//
// Phase H note: only the structural gate lands here (publish refuses to
// proceed without an explicit prior approval on the pages row) — the
// fuller Phase H scope (near-duplicate/uniqueness checks, volume
// throttles, product copy) is tracked as its own follow-up PR. This gate
// exists now, on day one of real publishing, rather than being bolted on
// after a window where publishing worked with no review requirement at
// all — the master prompt was explicit that this should be equal
// priority to Phase A, not a later add-on.

import { getPublisherAdapter } from './publisher-adapters'
import type { PublishArticleInput, PublisherCredentials, PublishResult, LivenessState } from './publisher-adapters/types'
import { transitionLiveness, appendLivenessHistory, type LivenessHistoryEntry } from './publisher-adapters/liveness-state-machine'

export interface PublishArticleParams {
  supabase: any
  userId: string
  articleId: string
  siteId: string
}

export interface PublishOutcome {
  success: boolean
  message: string
  liveUrl?: string | null
  liveness?: LivenessState
  pageId?: string
}

function extractHeroImageUrl(html: string): string | undefined {
  const match = html.match(/<img[^>]+src="([^"]+)"/i)
  return match?.[1]
}

export async function publishArticle(params: PublishArticleParams): Promise<PublishOutcome> {
  const { supabase, userId, articleId, siteId } = params
  const nowIso = new Date().toISOString()

  const { data: article } = await supabase
    .from('articles')
    .select('id, title, content, meta_description, article_url, brand, keyword')
    .eq('id', articleId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!article) {
    return { success: false, message: 'Article not found.' }
  }

  // Find (or create) the pages shadow record for this article — see the
  // publish_liveness migration's own comment for why this lives on `pages`
  // rather than `articles` or a new table.
  let { data: page } = await supabase
    .from('pages')
    .select('id, liveness_state, liveness_history, publish_approved_by')
    .eq('article_id', articleId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!page) {
    const { data: created, error: createErr } = await supabase
      .from('pages')
      .insert({ user_id: userId, article_id: articleId, stage: 6, status: 'queued' })
      .select('id, liveness_state, liveness_history, publish_approved_by')
      .single()
    if (createErr || !created) {
      return { success: false, message: `Could not create a pages record for this article: ${createErr?.message || 'unknown error'}` }
    }
    page = created
  }

  // ── Phase H structural gate: no prior approval, no publish attempt ────
  if (!page.publish_approved_by) {
    return {
      success: false,
      message: 'This article has not been approved for publishing yet. Call /api/publish/approve first — real publishing is review-gated by default.',
      pageId: page.id,
    }
  }

  const { data: connRow } = await supabase
    .from('site_connections')
    .select('*')
    .eq('site_id', siteId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!connRow) {
    return { success: false, message: 'No CMS connection found for this site. Connect it in Settings → Your Sites first.', pageId: page.id }
  }

  const { data: site } = await supabase
    .from('connected_sites')
    .select('id, domain')
    .eq('id', siteId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!site) {
    return { success: false, message: 'Site not found.', pageId: page.id }
  }

  const platform = connRow.cms_type || 'wordpress'
  const adapter = getPublisherAdapter(platform)

  // Same credential-shape fallback as site-autofix.ts, for connections made
  // before the generic `credentials` JSONB column existed.
  const creds: PublisherCredentials = {
    siteUrl: site.domain.startsWith('http') ? site.domain : `https://${site.domain}`,
    siteId,
    ...(connRow.credentials || {}),
    ...(platform === 'wordpress' && !connRow.credentials?.appPassword
      ? { username: connRow.wp_username, appPassword: connRow.wp_app_password }
      : {}),
  }

  const articleInput: PublishArticleInput = {
    title: article.title,
    bodyHtml: article.content,
    slug: (article.article_url || `/${article.keyword || article.id}`).replace(/^\/+/, '').replace(/[^a-z0-9-]+/gi, '-').toLowerCase(),
    metaDescription: article.meta_description || undefined,
    heroImageUrl: extractHeroImageUrl(article.content || ''),
    keyword: article.keyword || undefined,
  }

  let history: LivenessHistoryEntry[] = page.liveness_history || []

  // CREATED/FAILED -> PUBLISH_REQUESTED (FAILED case is a retry)
  const requestEvent = page.liveness_state === 'FAILED' ? 'RETRY' : 'PUBLISH_REQUESTED'
  const toRequested = transitionLiveness(page.liveness_state || 'CREATED', requestEvent)
  if (!toRequested.ok) {
    return { success: false, message: toRequested.error || 'Invalid liveness transition.', pageId: page.id, liveness: page.liveness_state }
  }
  history = appendLivenessHistory(history, { at: nowIso, event: requestEvent, from: toRequested.from, to: toRequested.to })

  await supabase.from('pages').update({
    liveness_state: toRequested.to,
    liveness_updated_at: nowIso,
    liveness_history: history,
    publish_platform: platform,
    updated_at: nowIso,
  }).eq('id', page.id)

  let result: PublishResult
  try {
    result = await adapter.publish(articleInput, creds)
  } catch (err) {
    result = {
      platform, platformPostId: null, liveUrl: null, status: 'FAILED',
      isLiveImmediately: false, requiresSeparateVerification: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const resultEvent =
    result.status === 'LIVE_UNVERIFIED' ? 'PUBLISH_SUCCEEDED_IMMEDIATE'
    : result.status === 'BUILD_PENDING' ? 'PUBLISH_SUCCEEDED_DEFERRED'
    : 'PUBLISH_FAILED'

  const finalTransition = transitionLiveness(toRequested.to, resultEvent)
  const finalState = finalTransition.ok ? finalTransition.to : 'FAILED'
  history = appendLivenessHistory(history, {
    at: nowIso, event: resultEvent, from: toRequested.to, to: finalState,
    detail: result.detail || result.error,
  })

  await supabase.from('pages').update({
    liveness_state: finalState,
    liveness_updated_at: nowIso,
    liveness_history: history,
    platform_post_id: result.platformPostId,
    url: result.liveUrl || undefined,
    published_at: finalState !== 'FAILED' ? nowIso : undefined,
    last_action: result.detail || result.error || null,
    updated_at: nowIso,
  }).eq('id', page.id)

  return {
    success: finalState !== 'FAILED',
    message: result.detail || result.error || 'Publish attempt completed.',
    liveUrl: result.liveUrl,
    liveness: finalState,
    pageId: page.id,
  }
}

export async function approveArticleForPublish(
  supabase: any,
  userId: string,
  articleId: string,
): Promise<{ success: boolean; message: string; pageId?: string; qualityReadyToPublish?: boolean | null }> {
  const { data: article } = await supabase
    .from('articles')
    .select('id, quality_ready_to_publish, quality_score')
    .eq('id', articleId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!article) return { success: false, message: 'Article not found.' }

  let { data: page } = await supabase
    .from('pages')
    .select('id')
    .eq('article_id', articleId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!page) {
    const { data: created, error: createErr } = await supabase
      .from('pages')
      .insert({ user_id: userId, article_id: articleId, stage: 6, status: 'queued' })
      .select('id')
      .single()
    if (createErr || !created) return { success: false, message: `Could not create a pages record: ${createErr?.message || 'unknown error'}` }
    page = created
  }

  await supabase.from('pages').update({
    publish_approved_by: userId,
    publish_approved_at: new Date().toISOString(),
  }).eq('id', page.id)

  return {
    success: true,
    message: 'Approved for publishing.',
    pageId: page.id,
    qualityReadyToPublish: article.quality_ready_to_publish,
  }
}

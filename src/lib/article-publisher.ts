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
// Phase H: approveArticleForPublish is the structural gate (publish
// refuses to proceed without an explicit prior approval on the pages row)
// AND now runs the two content-policy safeguards before granting that
// approval — near-duplicate detection (hard block: the spec's own wording,
// "flag... before it can publish", implies blocking) and a volume-throttle
// check (visible warning only, never a block — the spec is explicit about
// this, and there's no single authoritative Google-published threshold to
// block against). See publish-safeguards.ts for both.

import { getPublisherAdapter } from './publisher-adapters'
import type { PublishArticleInput, PublisherCredentials, PublishResult, LivenessState } from './publisher-adapters/types'
import { transitionLiveness, appendLivenessHistory, type LivenessHistoryEntry } from './publisher-adapters/liveness-state-machine'
import { checkNearDuplicate, checkVolumeThrottle, type DuplicateCheckResult, type VolumeCheckResult } from './publish-safeguards'
import { loadConnectionCredentials } from './site-connection-crypto'

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

  const loaded = loadConnectionCredentials(connRow)
  const creds: PublisherCredentials = {
    siteUrl: site.domain.startsWith('http') ? site.domain : `https://${site.domain}`,
    siteId,
    ...loaded,
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
    site_id: siteId,
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

export interface ApproveOutcome {
  success: boolean
  message: string
  pageId?: string
  qualityReadyToPublish?: boolean | null
  duplicateCheck?: DuplicateCheckResult
  volumeCheck?: VolumeCheckResult
}

export async function approveArticleForPublish(
  supabase: any,
  userId: string,
  articleId: string,
  siteId: string,
): Promise<ApproveOutcome> {
  const { data: article } = await supabase
    .from('articles')
    .select('id, title, content, quality_ready_to_publish, quality_score')
    .eq('id', articleId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!article) return { success: false, message: 'Article not found.' }

  const { data: site } = await supabase
    .from('connected_sites')
    .select('id')
    .eq('id', siteId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!site) return { success: false, message: 'Site not found.' }

  let { data: page } = await supabase
    .from('pages')
    .select('id')
    .eq('article_id', articleId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!page) {
    const { data: created, error: createErr } = await supabase
      .from('pages')
      .insert({ user_id: userId, article_id: articleId, stage: 6, status: 'queued', site_id: siteId })
      .select('id')
      .single()
    if (createErr || !created) return { success: false, message: `Could not create a pages record: ${createErr?.message || 'unknown error'}` }
    page = created
  }

  // ── Near-duplicate check — hard block ──────────────────────────────────
  const duplicateCheck = await checkNearDuplicate(supabase, userId, siteId, article.content || '', articleId)
  if (duplicateCheck.isDuplicate) {
    return {
      success: false,
      message: `This article is ${Math.round(duplicateCheck.similarity * 100)}% similar to "${duplicateCheck.mostSimilarTitle}", already published to this site — too close to be approved as distinct content. Rewrite it or publish the other one instead.`,
      pageId: page.id,
      qualityReadyToPublish: article.quality_ready_to_publish,
      duplicateCheck,
    }
  }

  // ── Volume throttle — warning only, never blocks ───────────────────────
  const volumeCheck = await checkVolumeThrottle(supabase, userId, siteId)

  await supabase.from('pages').update({
    publish_approved_by: userId,
    publish_approved_at: new Date().toISOString(),
    site_id: siteId,
  }).eq('id', page.id)

  return {
    success: true,
    message: volumeCheck.isHighVolume
      ? `Approved for publishing. Note: this site has published ${volumeCheck.count} articles in the last ${volumeCheck.windowHours}h, at or above the ${volumeCheck.threshold}-article heuristic threshold — this pace can look like scaled content abuse to Google even when every article is individually reviewed. Consider spacing publishes out.`
      : 'Approved for publishing.',
    pageId: page.id,
    qualityReadyToPublish: article.quality_ready_to_publish,
    duplicateCheck,
    volumeCheck,
  }
}

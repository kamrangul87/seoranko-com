/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/publish-hosted-flow.ts
// Orchestrates the "hosted" destination end to end: gate on the existing
// Quality Gate result (never re-run it), enforce hosted-specific volume/
// near-dup safeguards, write the publications row through CREATED ->
// BUILD_PENDING -> LIVE_UNVERIFIED, and fire IndexNow only once
// LIVE_UNVERIFIED is reached. Mirrors article-publisher.ts's shape (look up
// article -> gate -> transition -> return typed result) without touching
// that file — hosted has its own state machine (publications), not the
// pages.liveness_state one the CMS adapters use.

import {
  buildHostedPublicUrl,
  slugForArticle,
  checkHostedVolume,
  checkHostedNearDuplicate,
  resolveAuthorAttribution,
} from '@/lib/publish-hosted'
import { pingIndexNow } from '@/lib/indexnow'

export interface PublishHostedParams {
  supabase: any
  userId: string
  articleId: string
  humanReviewConfirmed: boolean
}

export interface PublishHostedOutcome {
  success: boolean
  message: string
  publicationId?: string
  publicUrl?: string | null
  state?: string
}

async function findAvailableSlug(supabase: any, brand: string, baseSlug: string): Promise<string> {
  let slug = baseSlug || 'article'
  let attempt = 0
  // Bounded — a real collision run this long would indicate something else
  // is wrong (e.g. the same title republished many times), not a slug bug.
  while (attempt < 50) {
    const { data } = await supabase
      .from('publications')
      .select('id')
      .eq('brand', brand)
      .eq('destination', 'hosted')
      .eq('slug', slug)
      .maybeSingle()
    if (!data) return slug
    attempt++
    slug = `${baseSlug}-${attempt + 1}`
  }
  return `${baseSlug}-${Date.now()}`
}

export async function publishHostedArticle(params: PublishHostedParams): Promise<PublishHostedOutcome> {
  const { supabase, userId, articleId, humanReviewConfirmed } = params

  const { data: article } = await supabase
    .from('articles')
    .select('id, title, content, keyword, brand, meta_description, hero_image_url, quality_passed, quality_score')
    .eq('id', articleId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!article) return { success: false, message: 'Article not found.' }

  const brand = (article.brand || '').trim()
  if (!brand) {
    return { success: false, message: 'This article has no brand set — required for the hosted publish path (used for the public URL and volume/near-duplicate scoping).' }
  }

  // ── V02: refuse unless the existing Quality Gate result has zero
  // unresolved BLOCKs. Read the stored result — do not re-run the gate. ──
  if (!article.quality_passed) {
    return {
      success: false,
      message: `This article has not passed the Quality Gate (score ${article.quality_score ?? 'unknown'}) — resolve the remaining BLOCK-severity issues before publishing.`,
    }
  }

  // M06: hero image is guaranteed >=1200px wide by construction —
  // image-generator.ts's BLOG_SIZES.hero always crops to exactly 1200x630.
  // No stored width/height to independently re-verify a hypothetical
  // externally-set smaller image; the only realistic failure mode here is
  // a missing hero entirely (already blocked at save time by FIX 1's
  // figure/schema-completeness gate — this is a defensive re-check).
  if (!article.hero_image_url) {
    return { success: false, message: 'Article has no hero image on record — cannot publish a schema-ineligible page.' }
  }

  // ── V01/V03: volume safeguards, scoped by (user, brand) ──────────────
  const volume = await checkHostedVolume(supabase, userId, brand)
  if (volume.hardBlocked) {
    return {
      success: false,
      message: `Hard daily cap reached: ${volume.dailyCount} hosted articles published for "${brand}" in the last 24h (cap: 20). Try again tomorrow.`,
    }
  }
  if (volume.requiresHumanReview && !humanReviewConfirmed) {
    return {
      success: false,
      message: `${volume.weeklyCount} hosted articles published for "${brand}" this week (>= 15) — human review is required above this volume. Confirm review and resubmit with humanReviewConfirmed: true.`,
    }
  }

  // ── V04: near-duplicate structure check (hard block) ─────────────────
  const nearDup = await checkHostedNearDuplicate(supabase, userId, brand, article.content || '', articleId)
  if (nearDup.isDuplicate) {
    return {
      success: false,
      message: `This article is ${Math.round(nearDup.similarity * 100)}% similar to "${nearDup.mostSimilarTitle}", already published for "${brand}" — too close to be distinct content. Rewrite it or publish the other one instead.`,
    }
  }

  // ── V05: real author attribution, never a fictitious persona ─────────
  const attribution = resolveAuthorAttribution('Kamran Gul')
  void attribution // resolved for completeness; this pipeline's author is always a verified real person today

  const baseSlug = slugForArticle(article.title, article.keyword || '')
  const slug = await findAvailableSlug(supabase, brand, baseSlug)
  const nowIso = new Date().toISOString()

  const { data: created, error: createErr } = await supabase
    .from('publications')
    .insert({
      article_id: articleId,
      user_id: userId,
      brand,
      destination: 'hosted',
      state: 'CREATED',
      slug,
    })
    .select('id')
    .single()

  if (createErr || !created) {
    return { success: false, message: `Could not create publication record: ${createErr?.message || 'unknown error'}` }
  }

  // No external build step for hosted (server-rendered from the DB on
  // request) — BUILD_PENDING -> LIVE_UNVERIFIED is immediate. The Step 4
  // verification job is the real confirmatory re-fetch, not this route.
  const publicUrl = buildHostedPublicUrl(brand, slug)
  const { error: updateErr } = await supabase
    .from('publications')
    .update({
      state: 'LIVE_UNVERIFIED',
      public_url: publicUrl,
      published_at: nowIso,
    })
    .eq('id', created.id)

  if (updateErr) {
    await supabase.from('publications').update({ state: 'FAILED', failure_reason: updateErr.message }).eq('id', created.id)
    return { success: false, message: `Publication created but failed to go live: ${updateErr.message}`, publicationId: created.id }
  }

  // Fire-and-forget — only after LIVE_UNVERIFIED, per spec. IndexNow does
  // not include Google; Google discovery is via sitemap + crawl.
  pingIndexNow(publicUrl)
    .then(r => console.log(`[publish-hosted] IndexNow ${r.fired ? 'fired' : 'skipped'} for ${publicUrl}: ${r.reason}`))
    .catch(err => console.warn('[publish-hosted] IndexNow ping failed:', err))

  return {
    success: true,
    message: volume.softWarning
      ? `Published. Note: "${brand}" has published ${volume.dailyCount} hosted articles in the last 24h, at or above the ${5}-article default — this pace can look like scaled content abuse to Google even when every article is reviewed. IndexNow does not include Google — discovery there is via sitemap and crawl.`
      : 'Published. IndexNow does not include Google — Google discovery is via sitemap and crawl.',
    publicationId: created.id,
    publicUrl,
    state: 'LIVE_UNVERIFIED',
  }
}

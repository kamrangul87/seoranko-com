// src/lib/publisher-adapters/wordpress-publisher.ts
// UNVERIFIED against a live WordPress site — no real Application Password
// credentials were available while building this (the user confirmed only
// GitHub/Vercel for autodun.com is available this round). Built strictly to
// the documented REST API contract and cross-checked against
// wordpress-connector.ts's existing, working auth code — but "builds and
// matches the docs" is not the same claim as "confirmed working." Treat
// this as needing a real smoke test before it's trusted with a live site.

import type {
  PublisherAdapter, PublisherCredentials, PublishArticleInput, PublishResult,
  LivenessCheckRef, LivenessCheckResult,
} from './types'

function authHeader(creds: PublisherCredentials): string {
  // Confirmed correct against wordpress-connector.ts's existing, working
  // implementation: username must be the real WP login username, NOT the
  // label given to the Application Password when it was generated — the
  // label is never sent anywhere and using it in place of the username
  // produces a silent 401 with no code path that explains the mistake.
  const username = creds.username || ''
  const appPassword = (creds.appPassword || '').replace(/\s/g, '')
  return `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`
}

function apiBase(creds: PublisherCredentials): string {
  return `${creds.siteUrl.replace(/\/$/, '')}/wp-json/wp/v2`
}

interface SeoMetaFields {
  [key: string]: string
}

// Both plugins' meta keys are attempted regardless of which (if either) is
// actually installed — an unregistered meta key just silently doesn't save,
// which the follow-up GET below is specifically checking for. Cheaper and
// more robust than trying to sniff the plugin first.
function buildSeoMeta(title: string, description: string | undefined): SeoMetaFields {
  const meta: SeoMetaFields = {
    _yoast_wpseo_title: title,
    rank_math_title: title,
  }
  if (description) {
    meta._yoast_wpseo_metadesc = description
    meta.rank_math_description = description
  }
  return meta
}

async function uploadFeaturedImage(
  creds: PublisherCredentials,
  imageUrl: string,
  slug: string,
): Promise<{ mediaId: number } | { error: string }> {
  // WordPress's standard media endpoint needs the actual file bytes, not a
  // URL — it has no built-in "sideload from URL" REST route. Fetch the
  // image ourselves, then re-upload it.
  let bytes: ArrayBuffer
  let contentType: string
  try {
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) })
    if (!imgRes.ok) return { error: `Could not fetch hero image (HTTP ${imgRes.status}) from ${imageUrl}.` }
    bytes = await imgRes.arrayBuffer()
    contentType = imgRes.headers.get('content-type') || 'image/jpeg'
  } catch (err) {
    return { error: `Could not fetch hero image: ${err instanceof Error ? err.message : String(err)}` }
  }

  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
  try {
    const res = await fetch(`${apiBase(creds)}/media`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(creds),
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${slug}.${ext}"`,
      },
      body: bytes,
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { error: err.message || `Media upload failed (HTTP ${res.status}).` }
    }
    const data = await res.json()
    return { mediaId: data.id }
  } catch (err) {
    return { error: `Media upload request failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export const wordpressPublisher: PublisherAdapter = {
  platform: 'wordpress',

  async publish(article: PublishArticleInput, creds: PublisherCredentials): Promise<PublishResult> {
    if (!creds.username || !creds.appPassword) {
      return {
        platform: 'wordpress', platformPostId: null, liveUrl: null, status: 'FAILED',
        isLiveImmediately: false, requiresSeparateVerification: true,
        error: 'WordPress username and Application Password are both required.',
      }
    }

    // ── Step 1: create the post first ──────────────────────────────────
    // Order matters: featured_media needs a real post ID to attach to, so
    // the post must exist before any image upload/association happens.
    const seoMeta = buildSeoMeta(article.title, article.metaDescription)
    let postId: number
    let postLink: string
    try {
      const res = await fetch(`${apiBase(creds)}/posts`, {
        method: 'POST',
        headers: { Authorization: authHeader(creds), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: article.title,
          content: article.bodyHtml,
          slug: article.slug,
          excerpt: article.metaDescription || undefined,
          status: 'publish',
          meta: seoMeta,
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return {
          platform: 'wordpress', platformPostId: null, liveUrl: null, status: 'FAILED',
          isLiveImmediately: false, requiresSeparateVerification: true,
          error: err.message || `WordPress rejected the post (HTTP ${res.status}). If this is a 401, double-check the username is the real WP login name, not the Application Password's label.`,
        }
      }
      const data = await res.json()
      postId = data.id
      postLink = data.link
    } catch (err) {
      return {
        platform: 'wordpress', platformPostId: null, liveUrl: null, status: 'FAILED',
        isLiveImmediately: false, requiresSeparateVerification: true,
        error: `WordPress post-create request failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    // ── Step 2/3: upload featured image, THEN associate it ─────────────
    const notes: string[] = []
    if (article.heroImageUrl) {
      const uploadResult = await uploadFeaturedImage(creds, article.heroImageUrl, article.slug)
      if ('error' in uploadResult) {
        notes.push(`Featured image not set: ${uploadResult.error}`)
      } else {
        try {
          const assocRes = await fetch(`${apiBase(creds)}/posts/${postId}`, {
            method: 'POST',
            headers: { Authorization: authHeader(creds), 'Content-Type': 'application/json' },
            body: JSON.stringify({ featured_media: uploadResult.mediaId }),
            signal: AbortSignal.timeout(15000),
          })
          if (!assocRes.ok) notes.push(`Featured image uploaded but could not be associated with the post (HTTP ${assocRes.status}).`)
        } catch (err) {
          notes.push(`Featured image uploaded but association request failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    // ── Verify SEO meta actually saved — a write can 200/201 and still
    // silently no-op if the target site's SEO plugin never registered
    // these keys for REST (show_in_rest). Trusting the write response
    // alone would misreport this as a success. ──────────────────────────
    try {
      const verifyRes = await fetch(`${apiBase(creds)}/posts/${postId}?context=edit`, {
        headers: { Authorization: authHeader(creds) },
        signal: AbortSignal.timeout(15000),
      })
      if (verifyRes.ok) {
        const verifyData = await verifyRes.json()
        const savedMeta = verifyData.meta || {}
        const yoastSaved = savedMeta._yoast_wpseo_title === article.title
        const rankMathSaved = savedMeta.rank_math_title === article.title
        if (!yoastSaved && !rankMathSaved) {
          notes.push('SEO title/description meta did not persist — the target site\'s SEO plugin likely hasn\'t registered these fields for REST (show_in_rest). Set them manually in the WP editor, or register the meta keys server-side.')
        }
      } else {
        notes.push('Could not verify whether SEO meta fields actually saved (follow-up GET failed).')
      }
    } catch {
      notes.push('Could not verify whether SEO meta fields actually saved (follow-up GET failed).')
    }

    return {
      platform: 'wordpress',
      platformPostId: String(postId),
      liveUrl: postLink,
      status: 'LIVE_UNVERIFIED',
      isLiveImmediately: true,
      requiresSeparateVerification: true,
      detail: notes.length > 0 ? notes.join(' ') : 'Post published.',
    }
  },

  async checkLiveness(ref: LivenessCheckRef): Promise<LivenessCheckResult> {
    try {
      const res = await fetch(`${apiBase(ref.creds)}/posts/${ref.platformPostId}?context=edit`, {
        headers: { Authorization: authHeader(ref.creds) },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) return { state: 'BUILD_PENDING', detail: `Could not confirm post status (HTTP ${res.status}).` }
      const data = await res.json()
      return data.status === 'publish'
        ? { state: 'LIVE_UNVERIFIED', detail: 'WordPress reports this post as published.' }
        : { state: 'BUILD_PENDING', detail: `WordPress reports status "${data.status}", not yet published.` }
    } catch (err) {
      return { state: 'BUILD_PENDING', detail: `Liveness check request failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}

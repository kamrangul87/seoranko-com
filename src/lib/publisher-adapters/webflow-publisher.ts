// src/lib/publisher-adapters/webflow-publisher.ts
// UNVERIFIED against a live Webflow site — no real API token was available
// while building this. Built to the documented Data API v2 shape, cross-
// checked against site-adapters/webflow-adapter.ts's existing working auth
// (same Bearer token + accept-version header).
//
// Deliberately uses POST /collections/{id}/items/live (creates AND
// publishes the single item in one call) rather than
// site-adapters/webflow-adapter.ts's existing pattern of "create as draft,
// then call POST /sites/{id}/publish" — that full-site-publish endpoint is
// separately rate-limited to one successful call per minute, which is fine
// for RANKO's occasional single-fix use case but would throttle real
// publishing at any meaningful volume. The /items/live endpoint sidesteps
// that limit entirely for the common case of publishing one article.

import type {
  PublisherAdapter, PublisherCredentials, PublishArticleInput, PublishResult,
  LivenessCheckRef, LivenessCheckResult,
} from './types'

const API = 'https://api.webflow.com/v2'

function webflowHeaders(apiToken: string) {
  return {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
    'accept-version': '2.0.0',
  }
}

interface WebflowField {
  slug: string
  type: string
}

// A collection's rich-text field name varies per site — rather than
// guessing from a fixed candidate list (as the existing RANKO adapter
// does, since it at least has a real item to inspect), this reads the
// collection's own declared schema and picks the first RichText-typed
// field, which is available even before any item exists.
async function resolveBodyField(creds: PublisherCredentials, collectionId: string): Promise<string | { error: string }> {
  if (creds.bodyFieldName) return creds.bodyFieldName
  try {
    const res = await fetch(`${API}/collections/${collectionId}`, {
      headers: webflowHeaders(creds.apiToken || ''),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { error: `Could not read collection schema (HTTP ${res.status}).` }
    const data = await res.json()
    const fields: WebflowField[] = data.fields || []
    const richText = fields.find(f => f.type === 'RichText')
    if (!richText) return { error: 'No RichText field found on this collection — set bodyFieldName explicitly in the site config.' }
    return richText.slug
  } catch (err) {
    return { error: `Collection schema request failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

interface WebflowItemResponse {
  id: string
  fieldData: Record<string, unknown>
  isDraft?: boolean
}

export const webflowPublisher: PublisherAdapter = {
  platform: 'webflow',

  async publish(article: PublishArticleInput, creds: PublisherCredentials): Promise<PublishResult> {
    if (!creds.apiToken) {
      return {
        platform: 'webflow', platformPostId: null, liveUrl: null, status: 'FAILED',
        isLiveImmediately: false, requiresSeparateVerification: true,
        error: 'A Webflow API token is required.',
      }
    }
    if (!creds.collectionId) {
      return {
        platform: 'webflow', platformPostId: null, liveUrl: null, status: 'FAILED',
        isLiveImmediately: false, requiresSeparateVerification: true,
        error: 'A Webflow collectionId is required — Webflow articles must belong to a CMS collection.',
      }
    }

    const bodyField = await resolveBodyField(creds, creds.collectionId)
    if (typeof bodyField !== 'string') {
      return {
        platform: 'webflow', platformPostId: null, liveUrl: null, status: 'FAILED',
        isLiveImmediately: false, requiresSeparateVerification: true, error: bodyField.error,
      }
    }

    const fieldData: Record<string, unknown> = {
      name: article.title,
      slug: article.slug,
      [bodyField]: article.bodyHtml,
    }
    // SEO fields on Webflow CMS items are just regular fields the site's
    // template maps to <meta> tags — there's no fixed universal slug for
    // them the way global.title_tag is fixed on Shopify, so only set them
    // when the site config says which field names its template expects.
    if (creds.seoTitleField && article.title) fieldData[creds.seoTitleField] = article.title
    if (creds.seoDescriptionField && article.metaDescription) fieldData[creds.seoDescriptionField] = article.metaDescription

    try {
      const res = await fetch(`${API}/collections/${creds.collectionId}/items/live`, {
        method: 'POST',
        headers: webflowHeaders(creds.apiToken),
        body: JSON.stringify({ fieldData }),
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        return {
          platform: 'webflow', platformPostId: null, liveUrl: null, status: 'FAILED',
          isLiveImmediately: false, requiresSeparateVerification: true,
          error: `Webflow item create failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        }
      }
      const data: WebflowItemResponse = await res.json()
      const liveUrl = `${creds.siteUrl.replace(/\/$/, '')}/${creds.urlPathPrefix || ''}${article.slug}`.replace(/([^:])\/{2,}/g, '$1/')

      return {
        platform: 'webflow',
        platformPostId: `${creds.collectionId}:${data.id}`,
        liveUrl,
        status: data.isDraft ? 'BUILD_PENDING' : 'LIVE_UNVERIFIED',
        isLiveImmediately: !data.isDraft,
        requiresSeparateVerification: true,
        detail: data.isDraft
          ? 'Item created but Webflow reports it as still draft — the site may be on staging-only or need a full-site publish.'
          : 'Item created via /items/live.',
      }
    } catch (err) {
      return {
        platform: 'webflow', platformPostId: null, liveUrl: null, status: 'FAILED',
        isLiveImmediately: false, requiresSeparateVerification: true,
        error: `Webflow request failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },

  async checkLiveness(ref: LivenessCheckRef): Promise<LivenessCheckResult> {
    const [collectionId, itemId] = ref.platformPostId.split(':')
    try {
      const res = await fetch(`${API}/collections/${collectionId}/items/${itemId}/live`, {
        headers: webflowHeaders(ref.creds.apiToken || ''),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) return { state: 'BUILD_PENDING', detail: `Could not confirm item status (HTTP ${res.status}).` }
      const data: WebflowItemResponse = await res.json()
      return data.isDraft
        ? { state: 'BUILD_PENDING', detail: 'Webflow still reports this item as draft.' }
        : { state: 'LIVE_UNVERIFIED', detail: 'Webflow reports this item as live.' }
    } catch (err) {
      return { state: 'BUILD_PENDING', detail: `Liveness check request failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}

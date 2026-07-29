/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/site-adapters/webflow-adapter.ts
// Webflow Data API v2. Credentials: { siteUrl, siteId, apiToken }
//   apiToken — Webflow → Site Settings → Apps & Integrations → API Access
//              (needs CMS read/write and site publish scopes)

import {
  CMSAdapter, SiteCredentials, PageContent, FixApplyResult,
  alreadyHasSchemaType, schemaScriptTag
} from './types'

const API = 'https://api.webflow.com/v2'

function webflowHeaders(apiToken: string) {
  return {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
    'accept-version': '2.0.0'
  }
}

// Collections name their rich-text field differently per site, so we find the
// body field on the item we read rather than assuming 'post-body'.
const BODY_FIELD_CANDIDATES = ['post-body', 'body', 'content', 'rich-text', 'article-body', 'post-content']

function findBodyField(fieldData: Record<string, any>): string | null {
  for (const candidate of BODY_FIELD_CANDIDATES) {
    if (typeof fieldData?.[candidate] === 'string') return candidate
  }
  // Fall back to the longest HTML-looking string field.
  let best: { field: string; len: number } | null = null
  for (const [key, value] of Object.entries(fieldData || {})) {
    if (typeof value === 'string' && value.includes('<') && value.length > (best?.len ?? 0)) {
      best = { field: key, len: value.length }
    }
  }
  return best?.field ?? null
}

/** Publish to the staging subdomain AND every custom domain, or the fix never goes live. */
async function publishSite(creds: SiteCredentials): Promise<{ ok: boolean; detail: string }> {
  try {
    const siteRes = await fetch(`${API}/sites/${creds.siteId}`, {
      headers: webflowHeaders(creds.apiToken || ''),
      signal: AbortSignal.timeout(15000)
    })
    const site = siteRes.ok ? await siteRes.json() : {}
    const customDomainIds = (site?.customDomains || []).map((d: any) => d.id).filter(Boolean)

    const res = await fetch(`${API}/sites/${creds.siteId}/publish`, {
      method: 'POST',
      headers: webflowHeaders(creds.apiToken || ''),
      body: JSON.stringify({
        publishToWebflowSubdomain: true,
        ...(customDomainIds.length ? { customDomains: customDomainIds } : {})
      }),
      signal: AbortSignal.timeout(20000)
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { ok: false, detail: `publish failed (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ''}` }
    }
    return {
      ok: true,
      detail: customDomainIds.length
        ? `published to staging and ${customDomainIds.length} custom domain(s)`
        : 'published to the Webflow staging subdomain (no custom domain configured)'
    }
  } catch {
    return { ok: false, detail: 'publish request failed' }
  }
}

async function writeBody(
  creds: SiteCredentials,
  page: PageContent,
  newBody: string
): Promise<FixApplyResult> {
  const [collectionId, itemId] = page.id.split(':')
  const field = page.bodyField
  if (!field) {
    return { success: false, error: 'Could not identify the rich-text field on this Webflow collection item.' }
  }

  try {
    const res = await fetch(`${API}/collections/${collectionId}/items/${itemId}`, {
      method: 'PATCH',
      headers: webflowHeaders(creds.apiToken || ''),
      body: JSON.stringify({ fieldData: { [field]: newBody } }),
      signal: AbortSignal.timeout(20000)
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { success: false, error: `Webflow update failed (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ''}` }
    }

    // Webflow requires an explicit publish for CMS changes to reach the live site.
    const pub = await publishSite(creds)
    if (!pub.ok) {
      return { success: false, error: `Content saved to Webflow but ${pub.detail} — the change is staged, not live.` }
    }
    return { success: true }
  } catch {
    return { success: false, error: 'Webflow update request failed' }
  }
}

export const webflowAdapter: CMSAdapter = {
  platform: 'webflow',
  serverVerifiable: true,

  async verifyConnection(creds) {
    if (!creds.siteId) return { success: false, error: 'Webflow Site ID is required.' }
    try {
      const res = await fetch(`${API}/sites/${creds.siteId}`, {
        headers: webflowHeaders(creds.apiToken || ''),
        signal: AbortSignal.timeout(15000)
      })
      if (res.status === 401 || res.status === 403) {
        return { success: false, error: 'Webflow rejected that API token — check it has CMS and publish permissions.' }
      }
      if (!res.ok) return { success: false, error: `Webflow rejected the connection (${res.status})` }
      const data = await res.json()
      return { success: true, detail: data.displayName }
    } catch {
      return { success: false, error: 'Could not reach the Webflow API' }
    }
  },

  async findPageContent(creds, url): Promise<PageContent | null> {
    const slug = url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop()
    if (!slug) return null

    try {
      const collectionsRes = await fetch(`${API}/sites/${creds.siteId}/collections`, {
        headers: webflowHeaders(creds.apiToken || ''),
        signal: AbortSignal.timeout(15000)
      })
      if (!collectionsRes.ok) return null
      const collectionsData = await collectionsRes.json()

      for (const collection of collectionsData.collections || []) {
        const itemsRes = await fetch(
          `${API}/collections/${collection.id}/items?slug=${encodeURIComponent(slug)}`,
          { headers: webflowHeaders(creds.apiToken || ''), signal: AbortSignal.timeout(15000) }
        )
        if (!itemsRes.ok) continue
        const itemsData = await itemsRes.json()
        if (!itemsData.items?.length) continue

        const item = itemsData.items[0]
        const fieldData = item.fieldData || {}
        const bodyField = findBodyField(fieldData)
        const bodyHtml = bodyField ? String(fieldData[bodyField] ?? '') : ''

        return {
          id: `${collection.id}:${item.id}`,
          url,
          title: fieldData.name || '',
          bodyHtml,
          hasSchema: bodyHtml.includes('application/ld+json'),
          bodyField: bodyField ?? undefined
        }
      }
      return null
    } catch {
      return null
    }
  },

  async injectSchema(creds, page, schemaJsonLd): Promise<FixApplyResult> {
    if (alreadyHasSchemaType(page.bodyHtml, schemaJsonLd)) {
      return { success: true, skipped: true }
    }
    return writeBody(creds, page, page.bodyHtml + schemaScriptTag(schemaJsonLd))
  },

  async appendContent(creds, page, html, position): Promise<FixApplyResult> {
    if (page.bodyHtml.includes('seoranko-added-byline')) {
      return { success: true, skipped: true }
    }
    const newBody = position === 'start' ? html + page.bodyHtml : page.bodyHtml + html
    return writeBody(creds, page, newBody)
  }
}

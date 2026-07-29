/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/site-adapters/shopify-adapter.ts
// Shopify Admin API. Credentials: { siteUrl, shopDomain, accessToken }
//   shopDomain  — 'your-store.myshopify.com'
//   accessToken — Custom App Admin API token (Shopify Admin → Settings → Apps
//                 → Develop apps), needs read_content + write_content scopes.

import {
  CMSAdapter, SiteCredentials, PageContent, FixApplyResult,
  alreadyHasSchemaType, schemaScriptTag
} from './types'

const API_VERSION = '2025-01'

function shopifyHeaders(accessToken: string) {
  return {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json'
  }
}

function shopHost(creds: SiteCredentials): string {
  // Only *.myshopify.com admin hosts are valid targets here.
  const host = (creds.shopDomain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return host
}

function isValidShopHost(host: string): boolean {
  return /^[a-z0-9-]+\.myshopify\.com$/i.test(host)
}

/** Single place that writes body_html back, used by both fix paths. */
async function updateBody(
  creds: SiteCredentials,
  pageId: string,
  newBody: string
): Promise<FixApplyResult> {
  const host = shopHost(creds)
  if (!isValidShopHost(host)) {
    return { success: false, error: 'Invalid Shopify store domain — expected your-store.myshopify.com' }
  }

  const [type, ...idParts] = pageId.split(':')

  const endpoint = type === 'page'
    ? `https://${host}/admin/api/${API_VERSION}/pages/${idParts[0]}.json`
    : `https://${host}/admin/api/${API_VERSION}/blogs/${idParts[0]}/articles/${idParts[1]}.json`

  const body = type === 'page'
    ? { page: { id: Number(idParts[0]), body_html: newBody } }
    : { article: { id: Number(idParts[1]), body_html: newBody } }

  try {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: shopifyHeaders(creds.accessToken || ''),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { success: false, error: `Shopify update failed (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ''}` }
    }
    return { success: true }
  } catch {
    return { success: false, error: 'Shopify update request failed' }
  }
}

export const shopifyAdapter: CMSAdapter = {
  platform: 'shopify',
  serverVerifiable: true,

  async verifyConnection(creds) {
    const host = shopHost(creds)
    if (!isValidShopHost(host)) {
      return { success: false, error: 'Enter the store domain in the form your-store.myshopify.com' }
    }
    try {
      const res = await fetch(
        `https://${host}/admin/api/${API_VERSION}/shop.json`,
        { headers: shopifyHeaders(creds.accessToken || ''), signal: AbortSignal.timeout(15000) }
      )
      if (res.status === 401 || res.status === 403) {
        return { success: false, error: 'Shopify rejected that access token — check it has read_content and write_content scopes.' }
      }
      if (!res.ok) {
        return { success: false, error: `Shopify rejected the connection (${res.status}) — check the store domain and token.` }
      }
      const data = await res.json()
      return { success: true, detail: data.shop?.name }
    } catch {
      return { success: false, error: 'Could not reach this Shopify store.' }
    }
  },

  async findPageContent(creds, url): Promise<PageContent | null> {
    const host = shopHost(creds)
    if (!isValidShopHost(host)) return null

    const handle = url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop()
    if (!handle) return null

    try {
      const pagesRes = await fetch(
        `https://${host}/admin/api/${API_VERSION}/pages.json?handle=${encodeURIComponent(handle)}`,
        { headers: shopifyHeaders(creds.accessToken || ''), signal: AbortSignal.timeout(15000) }
      )
      if (pagesRes.ok) {
        const pagesData = await pagesRes.json()
        if (pagesData.pages?.length) {
          const p = pagesData.pages[0]
          return {
            id: `page:${p.id}`,
            url,
            title: p.title || '',
            bodyHtml: p.body_html || '',
            hasSchema: (p.body_html || '').includes('application/ld+json')
          }
        }
      }

      const blogsRes = await fetch(
        `https://${host}/admin/api/${API_VERSION}/blogs.json`,
        { headers: shopifyHeaders(creds.accessToken || ''), signal: AbortSignal.timeout(15000) }
      )
      if (!blogsRes.ok) return null
      const blogsData = await blogsRes.json()

      for (const blog of blogsData.blogs || []) {
        const artRes = await fetch(
          `https://${host}/admin/api/${API_VERSION}/blogs/${blog.id}/articles.json?handle=${encodeURIComponent(handle)}`,
          { headers: shopifyHeaders(creds.accessToken || ''), signal: AbortSignal.timeout(15000) }
        )
        if (!artRes.ok) continue
        const artData = await artRes.json()
        if (artData.articles?.length) {
          const a = artData.articles[0]
          return {
            id: `article:${blog.id}:${a.id}`,
            url,
            title: a.title || '',
            bodyHtml: a.body_html || '',
            hasSchema: (a.body_html || '').includes('application/ld+json')
          }
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
    return updateBody(creds, page.id, page.bodyHtml + schemaScriptTag(schemaJsonLd))
  },

  async appendContent(creds, page, html, position): Promise<FixApplyResult> {
    if (page.bodyHtml.includes('seoranko-added-byline')) {
      return { success: true, skipped: true }
    }
    const newBody = position === 'start' ? html + page.bodyHtml : page.bodyHtml + html
    return updateBody(creds, page.id, newBody)
  }
}

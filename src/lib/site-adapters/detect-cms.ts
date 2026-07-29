// src/lib/site-adapters/detect-cms.ts
// Probes a domain to work out which platform it runs, so the user never has to
// know or select their own CMS type manually.

import { isSafePublicUrl } from '../fetch-page-content'

export type DetectedCMS = 'wordpress' | 'shopify' | 'webflow' | 'unknown'

export async function detectCMS(domain: string): Promise<DetectedCMS> {
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const url = `https://${cleanDomain}`

  // This fetches a caller-supplied host — same guard as the other outbound calls.
  if (!isSafePublicUrl(url)) return 'unknown'

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'SEORANKO-Detector/1.0' },
      redirect: 'follow'
    })
    const html = await res.text()
    const headers = res.headers

    // Shopify first — a Shopify store can also mention "wp-content" in a blog
    // post body, but these headers/CDN markers are unambiguous.
    if (
      headers.get('x-shopify-stage') ||
      headers.get('x-shopid') ||
      html.includes('cdn.shopify.com') ||
      html.includes('Shopify.theme')
    ) {
      return 'shopify'
    }

    if (
      /<meta[^>]+name=["']generator["'][^>]+content=["']Webflow/i.test(html) ||
      html.includes('assets.website-files.com') ||
      html.includes('assets-global.website-files.com')
    ) {
      return 'webflow'
    }

    if (
      /<meta[^>]+name=["']generator["'][^>]+content=["']WordPress/i.test(html) ||
      html.includes('/wp-content/') ||
      html.includes('/wp-json/') ||
      html.includes('/wp-includes/')
    ) {
      return 'wordpress'
    }

    return 'unknown'
  } catch {
    return 'unknown'
  }
}

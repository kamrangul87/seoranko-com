// Open Graph / Twitter Card meta tags plus a single SEO description.
// Callers must pass a real description from extractArticleDescription —
// never invent "Article about {keyword}" here.

import { stripSeoDescriptionTags, truncateAtWordBoundary } from '@/lib/extract-meta-description'

export interface SocialMetaTagsInput {
  title: string
  description: string
  url: string
  imageUrl?: string
}

export function buildSocialMetaTags(input: SocialMetaTagsInput): string {
  const { title, description, url, imageUrl } = input
  const safeTitle = title.replace(/"/g, '&quot;')
  const seoDesc = truncateAtWordBoundary(description, 160, description.length > 160)
  const safeSeoDesc = seoDesc.replace(/"/g, '&quot;')
  const longDesc = truncateAtWordBoundary(description, 200, description.length > 200)
  const safeDesc = longDesc.replace(/"/g, '&quot;')
  const safeUrl = url.replace(/"/g, '&quot;')

  return [
    `<meta name="description" content="${safeSeoDesc}" />`,
    '<meta property="og:type" content="article" />',
    `<meta property="og:title" content="${safeTitle}" />`,
    `<meta property="og:description" content="${safeDesc}" />`,
    `<meta property="og:url" content="${safeUrl}" />`,
    imageUrl ? `<meta property="og:image" content="${imageUrl}" />` : '',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${safeTitle}" />`,
    `<meta name="twitter:description" content="${safeDesc}" />`,
    imageUrl ? `<meta name="twitter:image" content="${imageUrl}" />` : '',
  ].filter(Boolean).join('\n')
}

/**
 * Strip any prior description/OG/Twitter description tags, then append one
 * consistent set — prevents the duplicate name=description bug (good model
 * tag + generic fallback appended after schema).
 */
export function appendSocialMetaTags(html: string, input: SocialMetaTagsInput): string {
  const cleaned = stripSeoDescriptionTags(html).replace(/\n{3,}/g, '\n\n').trimEnd()
  return `${cleaned}\n\n${buildSocialMetaTags(input)}`
}

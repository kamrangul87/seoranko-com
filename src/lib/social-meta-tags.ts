// Open Graph / Twitter Card meta tags. Grepped the entire pipeline for
// og:title, og:image, og:description, twitter:card — zero matches anywhere.
// Every generated article currently looks broken (title-less, image-less)
// when shared on LinkedIn, Slack, X, or pasted into any chat app that
// generates a link preview.
//
// Values are sourced from data already computed in article-v2/route.ts
// (articleTitle, articleDescription, heroImageUrl, and the same full
// article URL used for the JSON-LD schema's articleUrl) — no new
// generation, just missing wiring.
//
// finalHtml is a bare content fragment — confirmed no <html>/<head> tag
// exists anywhere in the article-v2 pipeline's output — so these tags are
// appended as a plain string, the same mechanism already used for the
// JSON-LD <script> tag (schemaResult.combinedScriptTag).

export interface SocialMetaTagsInput {
  title: string
  description: string
  url: string
  imageUrl?: string
}

export function buildSocialMetaTags(input: SocialMetaTagsInput): string {
  const { title, description, url, imageUrl } = input
  const safeTitle = title.replace(/"/g, '&quot;')
  const safeDesc = (description.length > 200 ? `${description.slice(0, 197)}...` : description).replace(/"/g, '&quot;')
  const safeUrl = url.replace(/"/g, '&quot;')

  return [
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

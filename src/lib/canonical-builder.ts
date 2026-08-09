// src/lib/canonical-builder.ts
// Builds canonical and essential meta tags for every SEORANKO article

// Grepped the pipeline: zero matches for rel="canonical" anywhere. Combined
// with the schema's articleUrl sometimes falling back to a placeholder
// (https://example.com/... when brand/domain is genuinely absent — this has
// already happened in a real saved article), a missing canonical tag risks
// duplicate-content signals if content is ever syndicated or the URL
// structure changes later.
//
// Minimal, single-purpose canonical tag — see buildCanonicalTags below for
// the fuller combined block (canonical + robots + description + OG/Twitter)
// used by the article-download export path. This is for the live
// article-v2 generation path, which needs just the canonical link on its
// own (OG/Twitter tags are wired separately, see social-meta-tags.ts).
export function buildCanonicalTag(url: string): string {
  return `<link rel="canonical" href="${url.replace(/"/g, '&quot;')}" />`
}

export interface CanonicalInput {
  articleUrl: string       // full canonical URL e.g. https://yoursite.com/blog/my-article
  title: string
  description: string
  imageUrl?: string
  publishDate: string      // ISO string
  authorName: string
  locale?: string          // default 'en_GB'
}

export function buildCanonicalTags(input: CanonicalInput): string {
  const {
    articleUrl,
    title,
    description,
    imageUrl,
    publishDate,
    authorName,
    locale = 'en_GB'
  } = input

  const metaDesc = description.length > 160
    ? description.slice(0, 157) + '...'
    : description

  const safeTitle = title.replace(/"/g, '&quot;')
  const safeDesc = metaDesc.replace(/"/g, '&quot;')
  const safeUrl = articleUrl.replace(/"/g, '&quot;')

  return `  <!-- Canonical — prevents duplicate content -->
  <link rel="canonical" href="${safeUrl}" />

  <!-- Meta description -->
  <meta name="description" content="${safeDesc}" />

  <!-- Robots — full indexing -->
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />

  <!-- Open Graph — for social sharing and AI crawlers -->
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:url" content="${safeUrl}" />
  <meta property="og:locale" content="${locale}" />
  ${imageUrl ? `<meta property="og:image" content="${imageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />` : ''}
  <meta property="article:published_time" content="${publishDate}" />
  <meta property="article:author" content="${authorName}" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDesc}" />
  ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}" />` : ''}`.trim()
}

// Builds the canonical URL from user domain + article slug
export function buildArticleUrl(domain: string, slug: string): string {
  const cleanDomain = domain.replace(/\/$/, '')
  const cleanSlug = slug.replace(/^\//, '')
  return `${cleanDomain}/blog/${cleanSlug}`
}

// Generates a URL-safe slug from article title
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

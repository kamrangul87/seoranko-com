import type { Metadata, MetadataRoute } from 'next'

/**
 * Public canonical origin for marketing metadata, canonicals, sitemap,
 * robots Sitemap line, Open Graph url, and JSON-LD. Production Vercel
 * 308s apex seoranko.com → www.seoranko.com, so canonicals must use www.
 */
export const SITE_ORIGIN = 'https://www.seoranko.com'

export const MARKETING_SITEMAP_URL = `${SITE_ORIGIN}/sitemap.xml`

/** Paths Google should not crawl on seoranko.com. Prefix match in robots.txt. */
export const ROBOTS_DISALLOW_PATHS = [
  '/dashboard',
  '/api',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/auth',
] as const

/** Prefixes that must never appear in the public marketing sitemap. */
export const PRIVATE_PATH_PREFIXES = [
  '/dashboard',
  '/api',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/auth',
  '/admin',
] as const

/**
 * Public marketing URLs only. No dashboard, auth, or API routes.
 * Privacy/terms are listed here for discovery; those pages keep their own
 * robots metadata (untouched in this change).
 */
export const PUBLIC_SITEMAP_PATHS = [
  '/',
  '/pricing',
  '/about',
  '/case-studies/autodun',
  '/privacy',
  '/terms',
  '/bot',
  '/tools/index-diagnosis',
] as const

export const AUTH_ROBOTS = { index: false, follow: false } as const

export function absoluteUrl(path: string): string {
  if (path === '/' || path === '') return SITE_ORIGIN
  const normalised = path.startsWith('/') ? path : `/${path}`
  return `${SITE_ORIGIN}${normalised}`
}

export function marketingSitemapEntries(): MetadataRoute.Sitemap {
  return PUBLIC_SITEMAP_PATHS.map((path) => ({
    url: absoluteUrl(path),
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority: path === '/' ? 1 : path === '/pricing' || path === '/about' ? 0.8 : 0.6,
  }))
}

export function buildRobotsConfig(brandSitemaps: string[] = []): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [...ROBOTS_DISALLOW_PATHS],
    },
    sitemap: [MARKETING_SITEMAP_URL, ...brandSitemaps],
  }
}

export function publicPageMetadata(opts: {
  path: string
  title: string
  description: string
  ogType?: 'website' | 'article'
}): Metadata {
  const url = absoluteUrl(opts.path)
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: url },
    openGraph: {
      title: opts.title,
      description: opts.description,
      type: opts.ogType ?? 'website',
      url,
    },
    twitter: {
      card: 'summary_large_image',
      title: opts.title,
      description: opts.description,
    },
  }
}

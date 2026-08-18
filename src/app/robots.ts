import type { MetadataRoute } from 'next'
import { listPublishedBrands } from '@/lib/public-article-loader'

const PUBLISH_DOMAIN = process.env.NEXT_PUBLIC_PUBLISH_DOMAIN || 'blog.seoranko.com'

// Depends on live publications data (which brands currently have
// published articles) — must not be frozen at build time.
export const dynamic = 'force-dynamic'

// Next's robots.ts convention — auto-served at /robots.txt. Allows
// crawling and references each active brand's own sitemap (one sitemap per
// brand, at /blog/[brand]/sitemap.xml — see sitemap.ts).
export default async function robots(): Promise<MetadataRoute.Robots> {
  const brands = await listPublishedBrands()
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: brands.map(b => `https://${PUBLISH_DOMAIN}/blog/${encodeURIComponent(b)}/sitemap.xml`),
  }
}

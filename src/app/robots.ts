import type { MetadataRoute } from 'next'
import { listPublishedBrands } from '@/lib/public-article-loader'
import { buildRobotsConfig } from '@/lib/public-site'

const PUBLISH_DOMAIN = process.env.NEXT_PUBLIC_PUBLISH_DOMAIN || 'blog.seoranko.com'

// Depends on live publications data (which brands currently have
// published articles) — must not be frozen at build time.
export const dynamic = 'force-dynamic'

// Next's robots.ts convention — auto-served at /robots.txt.
// Always lists https://seoranko.com/sitemap.xml first; brand sitemaps are
// appended when hosted publications exist. Dashboard, API, and auth paths
// are disallowed.
export default async function robots(): Promise<MetadataRoute.Robots> {
  let brandSitemaps: string[] = []
  try {
    const brands = await listPublishedBrands()
    brandSitemaps = brands.map(
      (b) => `https://${PUBLISH_DOMAIN}/blog/${encodeURIComponent(b)}/sitemap.xml`,
    )
  } catch {
    brandSitemaps = []
  }
  return buildRobotsConfig(brandSitemaps)
}

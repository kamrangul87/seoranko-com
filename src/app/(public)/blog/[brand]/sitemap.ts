import type { MetadataRoute } from 'next'
import { listPublishedForBrand } from '@/lib/public-article-loader'

// Depends on live publications data for this brand — must not be frozen
// at build time.
export const dynamic = 'force-dynamic'

// Next's sitemap.ts file convention — auto-served at
// /blog/[brand]/sitemap.xml. Only LIVE_VERIFIED and LIVE_UNVERIFIED rows,
// per spec — listPublishedForBrand already filters to those two states.
export default async function sitemap({ params }: { params: { brand: string } }): Promise<MetadataRoute.Sitemap> {
  const published = await listPublishedForBrand(params.brand)
  return published.map(p => ({
    url: p.publicUrl,
    lastModified: p.article.updatedAt,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }))
}

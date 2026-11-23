import type { MetadataRoute } from 'next'
import { marketingSitemapEntries } from '@/lib/public-site'

export default function sitemap(): MetadataRoute.Sitemap {
  return marketingSitemapEntries()
}

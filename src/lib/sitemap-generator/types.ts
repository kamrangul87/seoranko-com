import type { CrawlCoverage, PageIndexability } from '@/lib/index-diagnosis/types'

export type SitemapCheckSeverity = 'info' | 'warning' | 'error'

export interface SitemapCheck {
  id: string
  severity: SitemapCheckSeverity
  title: string
  detail: string
  urls?: string[]
}

export interface SitemapUrlEntry {
  /** Normalized loc written to XML. */
  loc: string
  /** Original crawled URL before style normalization. */
  crawledUrl: string
  lastmod?: string
}

export interface SitemapFile {
  filename: string
  content: string
  urlCount: number
}

export interface SitemapGeneratorResult {
  domain: string
  seedUrl: string
  crawlSource: 'reused' | 'fresh'
  crawlRanAt: string | null
  indexableCount: number
  files: SitemapFile[]
  checks: SitemapCheck[]
  /** One-line robots.txt addition when Sitemap: directive is missing. */
  robotsTxtSitemapDirective: string | null
  robotsTxtHasSitemap: boolean
  existingRobotsSitemapUrls: string[]
  placementGuidance: string
  linkedOnlyUrls: string[]
  urlStyleNormalized: boolean
}

export interface SitemapCrawlInput {
  domain: string
  seedUrl: string
  pages: PageIndexability[]
  coverage: CrawlCoverage
  htmlByUrl?: Record<string, string>
  robotsTxt: string
  ranAt: string | null
  crawlSource: 'reused' | 'fresh'
}

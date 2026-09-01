import { discoverSitemapUrls } from '@/lib/index-diagnosis/sitemap-discovery'
import { normalizeUrl } from '@/lib/supabase/audit-db'
import { generateSitemap } from './generate'
import type { SitemapCrawlInput } from './types'

export interface SitemapDriftReport {
  liveSitemapFetched: boolean
  liveSitemapEvidence: string
  missingFromLive: string[]
  deadInLive: string[]
  expectedIndexableCount: number
  liveUrlCount: number
  hasDrift: boolean
  /** Generated sitemap.xml content ready to apply. */
  generatedSitemapXml: string | null
  generatedSitemapPath: string
}

function normSet(urls: string[]): Set<string> {
  return new Set(urls.map((u) => normalizeUrl(u)))
}

/** Compare live sitemap.xml against INDEXABLE URLs from the current crawl. */
export async function detectSitemapDrift(input: SitemapCrawlInput): Promise<SitemapDriftReport> {
  const generated = generateSitemap(input)
  const primary = generated.files.find((f) => f.filename === 'sitemap.xml') || generated.files[0]
  const expectedUrls = primary
    ? Array.from(
        new Set(
          (primary.content.match(/<loc>([^<]+)<\/loc>/g) || []).map((m) =>
            m.replace(/<\/?loc>/g, '').trim(),
          ),
        ),
      )
    : []

  const expectedSet = normSet(expectedUrls)
  const indexableNorm = normSet(
    input.pages
      .filter((p) => p.verdict === 'INDEXABLE' && p.httpStatus >= 200 && p.httpStatus < 300)
      .map((p) => p.url),
  )

  const live = await discoverSitemapUrls(input.seedUrl, input.robotsTxt || '')
  const liveSet = normSet(live.urls)

  const missingFromLive = Array.from(indexableNorm).filter((u) => !liveSet.has(u))
  const deadInLive = live.urls.filter((u) => {
    const n = normalizeUrl(u)
    if (!expectedSet.has(n) && !indexableNorm.has(n)) {
      const page = input.pages.find((p) => normalizeUrl(p.url) === n)
      if (page && page.verdict !== 'INDEXABLE') return true
      if (input.coverage.excluded.some((e) => normalizeUrl(e.url) === n)) return true
      if (input.coverage.sitemapOnlyUrls.some((s) => normalizeUrl(s) === n)) return true
    }
    return false
  })

  const hasDrift =
    missingFromLive.length > 0 ||
    deadInLive.length > 0 ||
    (live.urls.length > 0 && expectedIndexableCountDiff(indexableNorm.size, live.urls.length))

  return {
    liveSitemapFetched: live.urls.length > 0,
    liveSitemapEvidence: live.evidence,
    missingFromLive,
    deadInLive: Array.from(new Set(deadInLive.map(normalizeUrl))),
    expectedIndexableCount: indexableNorm.size,
    liveUrlCount: live.urls.length,
    hasDrift: hasDrift || (live.urls.length === 0 && indexableNorm.size > 0),
    generatedSitemapXml: primary?.content || null,
    generatedSitemapPath: 'public/sitemap.xml',
  }
}

function expectedIndexableCountDiff(expected: number, live: number): boolean {
  if (expected === 0) return false
  return Math.abs(expected - live) >= 1
}

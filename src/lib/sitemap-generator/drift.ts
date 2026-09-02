import { discoverSitemapUrls } from '@/lib/index-diagnosis/sitemap-discovery'
import { normalizeUrl } from '@/lib/supabase/audit-db'
import { filterPagesForSitemapInclusion } from './canonical-inclusion'
import { generateSitemap } from './generate'
import { checkLiveSitemapUrlHealth, type LiveSitemapUrlHealth } from './live-health'
import { findNoindexInSitemapContradictions, type NoindexInSitemapContradiction } from './noindex-contradiction'
import type { SitemapCrawlInput } from './types'

export type { LiveSitemapUrlHealth, NoindexInSitemapContradiction }

export interface SitemapExcludedUrl {
  url: string
  keptUrl: string
  reason: string
}

export interface SitemapDriftReport {
  liveSitemapFetched: boolean
  liveSitemapEvidence: string
  /** URLs in the generated sitemap (same source as Preview / Sitemap Generator). */
  expectedSitemapUrls: string[]
  /** Indexable crawl URLs omitted from sitemap on purpose (e.g. canonical duplicate of another entry). */
  sitemapExcludedUrls: SitemapExcludedUrl[]
  /** Expected sitemap URLs absent from the live deployed sitemap.xml. */
  missingFromLive: string[]
  deadInLive: string[]
  expectedIndexableCount: number
  liveUrlCount: number
  hasDrift: boolean
  /** Generated sitemap.xml content ready to apply. */
  generatedSitemapXml: string | null
  generatedSitemapPath: string
  /** Live HTTP status check against deployed sitemap <loc> URLs. */
  liveHealthChecked: boolean
  liveHealthResults: LiveSitemapUrlHealth[]
  liveHealthFailures: LiveSitemapUrlHealth[]
  /** Sitemap lists URL but crawl found noindex on the page. */
  noindexContradictions: NoindexInSitemapContradiction[]
}

function normSet(urls: string[]): Set<string> {
  return new Set(urls.map((u) => normalizeUrl(u)))
}

function extractLocsFromXml(xml: string): string[] {
  return Array.from(
    new Set(
      (xml.match(/<loc>([^<]+)<\/loc>/g) || []).map((m) => m.replace(/<\/?loc>/g, '').trim()),
    ),
  )
}

/** Compare live sitemap.xml against the generated sitemap from the same crawl input. */
export async function detectSitemapDrift(input: SitemapCrawlInput): Promise<SitemapDriftReport> {
  const generated = generateSitemap(input)
  const primary = generated.files.find((f) => f.filename === 'sitemap.xml') || generated.files[0]
  const expectedSitemapUrls = primary ? extractLocsFromXml(primary.content) : []
  const expectedSet = normSet(expectedSitemapUrls)

  const { exclusions: sitemapExcludedUrls } = filterPagesForSitemapInclusion(
    input.pages,
    input.htmlByUrl,
  )

  const indexableNorm = normSet(
    input.pages
      .filter((p) => p.verdict === 'INDEXABLE' && p.httpStatus >= 200 && p.httpStatus < 300)
      .map((p) => p.url),
  )

  const live = await discoverSitemapUrls(input.seedUrl, input.robotsTxt || '')
  const liveSet = normSet(live.urls)

  // Compare live sitemap to generated expected URLs — never raw indexable crawl pages.
  const missingFromLive = expectedSitemapUrls.filter((u) => !liveSet.has(normalizeUrl(u)))

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

  let liveHealthResults: LiveSitemapUrlHealth[] = []
  let liveHealthFailures: LiveSitemapUrlHealth[] = []
  const liveHealthChecked = live.urls.length > 0

  if (liveHealthChecked) {
    liveHealthResults = await checkLiveSitemapUrlHealth(live.urls)
    liveHealthFailures = liveHealthResults.filter((r) => !r.ok)
  }

  const noindexContradictions =
    live.urls.length > 0
      ? findNoindexInSitemapContradictions(live.urls, input.pages, input.coverage)
      : []

  const hasDrift =
    missingFromLive.length > 0 ||
    deadInLive.length > 0 ||
    liveHealthFailures.length > 0 ||
    noindexContradictions.length > 0 ||
    (live.urls.length > 0 && expectedSet.size !== liveSet.size) ||
    (live.urls.length === 0 && expectedSitemapUrls.length > 0)

  return {
    liveSitemapFetched: live.urls.length > 0,
    liveSitemapEvidence: live.evidence,
    expectedSitemapUrls,
    sitemapExcludedUrls,
    missingFromLive,
    deadInLive: Array.from(new Set(deadInLive.map(normalizeUrl))),
    expectedIndexableCount: expectedSitemapUrls.length,
    liveUrlCount: live.urls.length,
    hasDrift,
    generatedSitemapXml: primary?.content || null,
    generatedSitemapPath: 'public/sitemap.xml',
    liveHealthChecked,
    liveHealthResults,
    liveHealthFailures,
    noindexContradictions,
  }
}

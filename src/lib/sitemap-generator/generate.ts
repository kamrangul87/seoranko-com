import { extractSitemapUrlsFromRobots } from '@/lib/index-diagnosis/robots-parser'
import { filterPagesForSitemapInclusion } from './canonical-inclusion'
import { lastmodFromHtml } from './lastmod'
import { analyzeAndNormalizeUrls } from './url-style'
import type { SitemapCheck, SitemapCrawlInput, SitemapGeneratorResult, SitemapUrlEntry } from './types'
import { buildSitemapFiles } from './xml'

function publicBaseUrl(seedUrl: string, domain: string): string {
  try {
    const u = new URL(seedUrl.startsWith('http') ? seedUrl : `https://${domain}/`)
    return `${u.protocol}//${u.hostname}`
  } catch {
    return `https://${domain}`
  }
}

function robotsSitemapDirective(publicBase: string): string {
  return `Sitemap: ${publicBase.replace(/\/$/, '')}/sitemap.xml`
}

function buildPlacementGuidance(domain: string, cmsType?: string | null): string {
  const isNext = cmsType === 'github' || cmsType === 'nextjs'
  const lines = [
    'Where to put this file:',
    '',
    'Static / traditional hosting: upload sitemap.xml to your site root (same folder as index.html) so it is served at https://' +
      domain +
      '/sitemap.xml.',
    '',
  ]
  if (isNext) {
    lines.push(
      'Next.js (App Router): prefer app/sitemap.ts — Next.js auto-generates /sitemap.xml at build time. Export a default function that returns the same URL list. Do not also upload a static public/sitemap.xml unless you disable the dynamic route.',
      '',
      'Next.js (Pages Router): use next-sitemap or pages/sitemap.xml.js, or place public/sitemap.xml for a static file.',
      '',
    )
  } else {
    lines.push(
      'Next.js sites: if you use the App Router, app/sitemap.ts auto-generates /sitemap.xml — mirror this URL list there instead of a static file when possible.',
      '',
    )
  }
  lines.push(
    'After publishing, confirm https://' +
      domain +
      '/sitemap.xml returns the file (or your sitemap-index.xml if split). Submit the index URL in Google Search Console if you use multiple files.',
  )
  return lines.join('\n')
}

export function generateSitemap(input: SitemapCrawlInput, opts?: { cmsType?: string | null }): SitemapGeneratorResult {
  const { pages: indexablePages, exclusions: canonicalExclusions } = filterPagesForSitemapInclusion(
    input.pages,
    input.htmlByUrl,
  )
  const crawledUrls = indexablePages.map((p) => p.url)
  const styleReport = analyzeAndNormalizeUrls(crawledUrls)

  const entries: SitemapUrlEntry[] = []
  const seenLocs = new Set<string>()

  for (const page of indexablePages) {
    const loc = styleReport.normalizedUrls.get(page.url) || page.url
    if (seenLocs.has(loc)) continue
    seenLocs.add(loc)
    const lastmod = lastmodFromHtml(input.htmlByUrl?.[page.url])
    entries.push({ loc, crawledUrl: page.url, lastmod })
  }

  entries.sort((a, b) => a.loc.localeCompare(b.loc))

  const base = publicBaseUrl(input.seedUrl, input.domain)
  const files = buildSitemapFiles(entries, base)

  const checks: SitemapCheck[] = []

  if (styleReport.mixedScheme) {
    checks.push({
      id: 'mixed-scheme',
      severity: 'warning',
      title: 'Mixed http/https in crawled URLs',
      detail: `Crawl found both http and https variants. Sitemap uses ${styleReport.style.scheme} consistently. Pick one canonical scheme sitewide and redirect the other.`,
      urls: styleReport.styleCorrections.slice(0, 8).map((c) => c.crawled),
    })
  }

  if (styleReport.mixedTrailingSlash) {
    checks.push({
      id: 'mixed-trailing-slash',
      severity: 'warning',
      title: 'Mixed trailing-slash usage',
      detail: `Some crawled URLs end with / and others do not. Sitemap normalized to ${styleReport.style.trailingSlash ? 'trailing slashes on paths' : 'no trailing slashes (except root)'}. Use one convention and redirect duplicates.`,
      urls: styleReport.styleCorrections.slice(0, 8).map((c) => c.crawled),
    })
  }

  if (styleReport.styleCorrections.length > 0) {
    checks.push({
      id: 'url-style-normalized',
      severity: 'info',
      title: `${styleReport.styleCorrections.length} URL(s) normalized for consistent sitemap output`,
      detail: 'These crawled URLs were rewritten to match the dominant http/https and trailing-slash style.',
      urls: styleReport.styleCorrections.slice(0, 12).map((c) => `${c.crawled} → ${c.normalized}`),
    })
  }

  const locSet = new Set(entries.map((e) => e.loc))
  const duplicateGroups = new Map<string, string[]>()
  for (const page of indexablePages) {
    const loc = styleReport.normalizedUrls.get(page.url) || page.url
    const list = duplicateGroups.get(loc) || []
    list.push(page.url)
    duplicateGroups.set(loc, list)
  }
  const dupes = Array.from(duplicateGroups.entries()).filter(([, urls]) => urls.length > 1)
  if (dupes.length > 0) {
    checks.push({
      id: 'duplicate-urls',
      severity: 'warning',
      title: 'Duplicate URLs collapse to the same sitemap entry',
      detail: 'Multiple crawled URLs normalize to the same loc (http/https or trailing-slash variants). Keep one canonical URL and redirect the rest.',
      urls: dupes.slice(0, 10).map(([loc, urls]) => `${loc} ← ${urls.join(', ')}`),
    })
  }

  const blockedInSitemap = input.pages.filter(
    (p) => (p.verdict === 'BLOCKED' || p.verdict === 'AT_RISK') && locSet.has(styleReport.normalizedUrls.get(p.url) || p.url),
  )
  if (blockedInSitemap.length > 0) {
    checks.push({
      id: 'safety-blocked-in-sitemap',
      severity: 'error',
      title: 'BLOCKED/AT_RISK URL in generated sitemap (unexpected)',
      detail: 'Generation logic should exclude non-INDEXABLE pages — treat this as a bug if you see it.',
      urls: blockedInSitemap.map((p) => `${p.url} (${p.verdict})`),
    })
  }

  if (input.coverage.sitemapOnlyUrls.length > 0) {
    checks.push({
      id: 'orphaned-in-sitemap',
      severity: 'warning',
      title: `${input.coverage.sitemapOnlyUrls.length} URL(s) in existing sitemap but not linked internally`,
      detail: 'These were discovered via sitemap.xml during the crawl but no internal links point to them — often stale or deleted pages still listed. Review before including in a new sitemap.',
      urls: input.coverage.sitemapOnlyUrls.slice(0, 20),
    })
  }

  if (input.coverage.linkedOnlyUrls.length > 0) {
    checks.push({
      id: 'linked-not-in-existing-sitemap',
      severity: 'info',
      title: `${input.coverage.linkedOnlyUrls.length} indexable URL(s) linked internally but missing from current sitemap`,
      detail: 'These URLs are included in the generated sitemap below.',
      urls: input.coverage.linkedOnlyUrls.slice(0, 20),
    })
  }

  const existingRobotsSitemapUrls = extractSitemapUrlsFromRobots(input.robotsTxt)
  const robotsTxtHasSitemap = existingRobotsSitemapUrls.length > 0
  let robotsTxtSitemapDirective: string | null = null

  if (!robotsTxtHasSitemap) {
    robotsTxtSitemapDirective = robotsSitemapDirective(base)
    checks.push({
      id: 'robots-missing-sitemap',
      severity: 'warning',
      title: 'robots.txt does not reference your sitemap',
      detail: `Add this line to robots.txt so crawlers can find the sitemap:\n${robotsTxtSitemapDirective}`,
    })
  } else {
    checks.push({
      id: 'robots-sitemap-present',
      severity: 'info',
      title: 'robots.txt already references a sitemap',
      detail: existingRobotsSitemapUrls.join('\n'),
    })
  }

  if (canonicalExclusions.length > 0) {
    checks.push({
      id: 'canonical-duplicates-excluded',
      severity: 'info',
      title: `${canonicalExclusions.length} non-canonical duplicate URL(s) excluded from sitemap`,
      detail:
        'These crawled URLs are directory/index.html variants or canonical aliases of another listed URL. Only the preferred representative is included.',
      urls: canonicalExclusions.slice(0, 20).map((e) => `${e.url} → kept ${e.keptUrl}`),
    })
  }

  if (entries.length === 0) {
    checks.push({
      id: 'no-indexable-urls',
      severity: 'warning',
      title: 'No INDEXABLE URLs found in crawl',
      detail: 'Run Index Diagnosis on the homepage first, or check for sitewide noindex / robots blocks.',
    })
  }

  if (files.some((f) => f.filename.startsWith('sitemap-') && f.filename !== 'sitemap-index.xml')) {
    checks.push({
      id: 'sitemap-split',
      severity: 'info',
      title: 'Sitemap split into multiple files',
      detail: 'URL count or file size exceeded Google limits (50,000 URLs / 50MB). Use sitemap-index.xml as the canonical submission URL.',
    })
  }

  return {
    domain: input.domain,
    seedUrl: input.seedUrl,
    crawlSource: input.crawlSource,
    crawlRanAt: input.ranAt,
    indexableCount: entries.length,
    files,
    checks,
    robotsTxtSitemapDirective,
    robotsTxtHasSitemap,
    existingRobotsSitemapUrls,
    placementGuidance: buildPlacementGuidance(input.domain, opts?.cmsType),
    linkedOnlyUrls: input.coverage.linkedOnlyUrls,
    urlStyleNormalized: styleReport.styleCorrections.length > 0,
  }
}

export { buildPlacementGuidance }

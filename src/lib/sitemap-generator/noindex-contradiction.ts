import { normalizeUrl } from '@/lib/supabase/audit-db'
import type { CrawlCoverage, PageIndexability } from '@/lib/index-diagnosis/types'

export type NoindexSource = 'meta_robots' | 'x_robots'

export interface NoindexInSitemapContradiction {
  url: string
  source: NoindexSource
  evidence: string
  fixGuidance: string
}

const FIX_GUIDANCE =
  'Conflicting signals: the sitemap tells search engines to crawl/index this URL, but the page says noindex. ' +
  'Either remove the URL from sitemap.xml (if the page should stay noindex), or remove the noindex directive from the page (if it should be indexed).'

function noindexFromPage(page: PageIndexability): NoindexInSitemapContradiction | null {
  const metaStep = page.steps.find((s) => s.step === 'meta_robots')
  if (metaStep && !metaStep.passed) {
    return { url: page.url, source: 'meta_robots', evidence: metaStep.evidence, fixGuidance: FIX_GUIDANCE }
  }
  const xStep = page.steps.find((s) => s.step === 'x_robots')
  if (xStep && !xStep.passed) {
    return { url: page.url, source: 'x_robots', evidence: xStep.evidence, fixGuidance: FIX_GUIDANCE }
  }
  return null
}

function noindexFromExcluded(
  url: string,
  coverage: CrawlCoverage,
): NoindexInSitemapContradiction | null {
  const norm = normalizeUrl(url)
  const row = coverage.excluded.find((e) => normalizeUrl(e.url) === norm)
  if (!row) return null
  if (row.reason === 'META_NOINDEX') {
    return { url, source: 'meta_robots', evidence: row.evidence, fixGuidance: FIX_GUIDANCE }
  }
  if (row.reason === 'X_ROBOTS_NOINDEX') {
    return { url, source: 'x_robots', evidence: row.evidence, fixGuidance: FIX_GUIDANCE }
  }
  return null
}

/**
 * Find live sitemap URLs that contradict indexability: listed in sitemap but noindex
 * per the Index Diagnosis crawl (meta robots or X-Robots-Tag).
 */
export function findNoindexInSitemapContradictions(
  liveSitemapUrls: string[],
  pages: PageIndexability[],
  coverage: CrawlCoverage,
): NoindexInSitemapContradiction[] {
  const pageByNorm = new Map(pages.map((p) => [normalizeUrl(p.url), p]))
  const out: NoindexInSitemapContradiction[] = []
  const seen = new Set<string>()

  for (const url of liveSitemapUrls) {
    const norm = normalizeUrl(url)
    if (seen.has(norm)) continue
    seen.add(norm)

    const page = pageByNorm.get(norm)
    const hit = page ? noindexFromPage(page) : noindexFromExcluded(url, coverage)
    if (hit) out.push(hit)
  }

  return out
}

import { runIndexCrawl } from './crawler'
import { evaluateAllPages } from './indexability'
import { buildCohortComparison } from './cohorts'
import { buildIndexDiagnosisVerdict } from './verdict'
import { buildSiteFollowUpTasks } from './follow-up-tasks'
import { buildInboundLinkMap, buildManualFixesForResult } from './manual-fixes'
import { filterLinkedOnlyUrls, buildSitemapGapFilterContext } from './sitemap-gap-filter'
import type { IndexDiagnosisResult } from './types'

/**
 * Run full Index Diagnosis for a seed URL (domain crawl + indexability + cohorts).
 * Crawl data only — no external SERP or paid APIs.
 */
export async function runIndexDiagnosis(seedUrl: string): Promise<IndexDiagnosisResult> {
  const crawl = await runIndexCrawl(seedUrl)
  const pages = evaluateAllPages(crawl.fetchedPages, crawl.robotsTxt)

  const gapCtx = buildSitemapGapFilterContext(crawl.coverage, crawl.fetchedPages, pages)
  crawl.coverage.linkedOnlyUrls = filterLinkedOnlyUrls(crawl.coverage.linkedOnlyUrls, gapCtx)

  const cohorts = buildCohortComparison(pages)
  const verdict = buildIndexDiagnosisVerdict(crawl.coverage, pages)
  const partial: IndexDiagnosisResult = {
    coverage: crawl.coverage,
    pages,
    cohorts,
    verdict,
    followUpTasks: [],
    ranAt: '',
  }
  const followUpTasks = buildSiteFollowUpTasks(partial)
  partial.followUpTasks = followUpTasks

  const inboundMap = buildInboundLinkMap(crawl.fetchedPages)
  const inboundLinksByUrl: IndexDiagnosisResult['inboundLinksByUrl'] = {}
  for (const [target, links] of Array.from(inboundMap.entries())) {
    inboundLinksByUrl[target] = links
  }
  const manualFixesByTaskId = buildManualFixesForResult(
    { ...partial, followUpTasks },
    inboundMap,
  )

  const htmlByUrl: Record<string, string> = {}
  for (const p of crawl.fetchedPages) htmlByUrl[p.finalUrl] = p.html

  return {
    coverage: crawl.coverage,
    pages,
    cohorts,
    verdict,
    followUpTasks,
    manualFixesByTaskId,
    inboundLinksByUrl,
    htmlByUrl,
    robotsTxt: crawl.robotsTxt,
    ranAt: new Date().toISOString(),
  }
}

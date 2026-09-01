import { runIndexCrawl } from './crawler'
import { evaluateAllPages } from './indexability'
import { buildCohortComparison } from './cohorts'
import { buildIndexDiagnosisVerdict } from './verdict'
import type { IndexDiagnosisResult } from './types'

/**
 * Run full Index Diagnosis for a seed URL (domain crawl + indexability + cohorts).
 * Crawl data only — no external SERP or paid APIs.
 */
export async function runIndexDiagnosis(seedUrl: string): Promise<IndexDiagnosisResult> {
  const crawl = await runIndexCrawl(seedUrl)
  const pages = evaluateAllPages(crawl.fetchedPages, crawl.robotsTxt)
  const cohorts = buildCohortComparison(pages)
  const verdict = buildIndexDiagnosisVerdict(crawl.coverage, pages)

  return {
    coverage: crawl.coverage,
    pages,
    cohorts,
    verdict,
    ranAt: new Date().toISOString(),
  }
}

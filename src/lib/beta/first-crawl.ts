/**
 * First-crawl checklist: Audit crawls live in the findings store
 * (`fix_strategies_crawl_runs`). Index Diagnosis is a separate Diagnostics
 * tool. Either counts as "first crawl complete".
 */
export function isFirstCrawlComplete(input: {
  indexDiagnosisRunCount: number
  findingsTerminalRunCount: number
}): boolean {
  return input.indexDiagnosisRunCount > 0 || input.findingsTerminalRunCount > 0
}

export function isTerminalFindingsRunStatus(
  status: string | null | undefined,
): boolean {
  return status === 'complete' || status === 'partial'
}

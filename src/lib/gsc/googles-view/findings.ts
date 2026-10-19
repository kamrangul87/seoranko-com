/**
 * Surface Google's view PROBLEM URL verdicts as findings-list rows
 * (deterministic; links to existing topic fixers).
 */

import type { GooglesViewTable, UrlVerdictDetail } from './types'

export type GooglesViewFinding = {
  topicId: string
  verdict: 'googles-view-problem'
  pageUrl: string
  detail: string
  severity: 'moderate' | 'high'
  autoFixable: false
  evidenceValues: Record<string, unknown>
}

function primaryTopic(url: UrlVerdictDetail, reasonKind: string): string {
  if (url.relatedTopics && url.relatedTopics.length > 0) {
    return url.relatedTopics[0]!
  }
  if (reasonKind === 'page_with_redirect') return '4'
  if (reasonKind === 'not_found_404') return '26'
  if (reasonKind === 'alternate_canonical') return '55'
  return 'gsc'
}

export function googlesViewProblemFindings(
  table: GooglesViewTable,
): GooglesViewFinding[] {
  const out: GooglesViewFinding[] = []
  for (const row of table.rows) {
    if (!row.problem) continue
    for (const u of row.urls) {
      if (!u.problem) continue
      out.push({
        topicId: primaryTopic(u, row.reasonKind),
        verdict: 'googles-view-problem',
        pageUrl: u.url,
        detail: `Google's view · ${row.reason}: ${u.detail}`,
        severity: 'moderate',
        autoFixable: false,
        evidenceValues: {
          gscReason: row.reason,
          reasonKind: row.reasonKind,
          destinationOrStatus: u.destinationOrStatus,
          problemReasons: u.problemReasons || [],
          relatedTopics: u.relatedTopics || [],
          googlesView: true,
        },
      })
    }
  }
  return out
}

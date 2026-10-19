import type { GooglesViewReasonKind } from './types'

export function coverageStateToReasonKind(
  coverageState: string | null | undefined,
): GooglesViewReasonKind {
  if (!coverageState) return 'other'
  if (/page with redirect/i.test(coverageState)) return 'page_with_redirect'
  if (/alternate page with proper canonical/i.test(coverageState)) {
    return 'alternate_canonical'
  }
  if (/not found\s*\(404\)/i.test(coverageState)) return 'not_found_404'
  if (/crawled\s*[-—]\s*currently not indexed/i.test(coverageState)) {
    return 'crawled_not_indexed'
  }
  if (/discovered\s*[-—]\s*currently not indexed/i.test(coverageState)) {
    return 'discovered_not_indexed'
  }
  return 'other'
}

/** True when this coverage state belongs in the Google's view not-indexed table. */
export function isNotIndexedCoverageState(
  coverageState: string | null | undefined,
): boolean {
  if (!coverageState) return false
  if (/submitted and indexed/i.test(coverageState)) return false
  if (/indexed/i.test(coverageState) && !/not indexed/i.test(coverageState)) {
    // e.g. "Indexed, though blocked by robots.txt" — still a Google view row
    return true
  }
  if (/url is unknown to google/i.test(coverageState)) return false
  return true
}

/** Narrower: only the reasons we explain in the product table. */
export function isExplainedNotIndexedReason(
  coverageState: string | null | undefined,
): boolean {
  const kind = coverageStateToReasonKind(coverageState)
  return kind !== 'other'
}

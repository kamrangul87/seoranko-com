/**
 * Finding lifecycle statuses that mean "currently present" — still a live
 * problem for UI, counts, crawl_compare, and fix-run selection.
 *
 * `resolved` / `superseded` are history only.
 */
import type { FindingStatus } from './crawl/constants'

export function isCurrentlyPresentFindingStatus(
  status: FindingStatus | string | null | undefined,
): boolean {
  return status === 'open' || status === 'regressed'
}

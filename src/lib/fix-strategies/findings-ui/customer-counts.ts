/**
 * Hide internal-bucket counts from non-master customers (Overview + Audit).
 */

import { isMasterUserEmail } from '@/lib/stripe/entitlements'

export type FindingsBucketCounts = {
  actionable: number
  informational: number
  internal: number
}

export function countsForViewer(
  counts: FindingsBucketCounts,
  email: string | null | undefined,
): FindingsBucketCounts {
  if (isMasterUserEmail(email)) return counts
  return {
    actionable: counts.actionable,
    informational: counts.informational,
    internal: 0,
  }
}

export function shouldShowInternalCounts(
  email: string | null | undefined,
): boolean {
  return isMasterUserEmail(email)
}

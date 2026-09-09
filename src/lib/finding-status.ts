/**
 * Single status vocabulary for beta findings (PRODUCT_MODEL.md).
 * Maps Fix Agent / Link Graph / connection state into one customer-facing label.
 */

export type FindingStatus =
  | 'Auto-fixable'
  | 'Human review required'
  | 'Connection required'
  | 'Implemented'
  | 'Verified'
  | 'Awaiting Google recrawl'
  | 'Failed'
  | 'Invalid evidence'

export type FixAttemptStatusInput =
  | 'verified'
  | 'unverified'
  | 'pr_pending'
  | 'pending_deploy'
  | 'pending_merge'
  | 'applied'
  | 'failed'
  | string

export function findingStatusFromFixAttempt(opts: {
  status: FixAttemptStatusInput
  /** When Google lastCrawlTime is known and predates verified_at */
  awaitingGoogleRecrawl?: boolean
  /** Live verify failed with stored reason */
  failed?: boolean
}): FindingStatus {
  if (opts.failed || opts.status === 'failed') return 'Failed'
  if (opts.status === 'verified') {
    return opts.awaitingGoogleRecrawl ? 'Awaiting Google recrawl' : 'Verified'
  }
  // Write succeeded but live match not confirmed
  if (
    opts.status === 'unverified' ||
    opts.status === 'pending_deploy' ||
    opts.status === 'applied'
  ) {
    return 'Implemented'
  }
  // PR path is still a write that has not landed on the live default branch
  if (opts.status === 'pr_pending' || opts.status === 'pending_merge') {
    return 'Implemented'
  }
  return 'Human review required'
}

export function findingStatusForOpenIssue(opts: {
  autoFixable: boolean
  connectionPresent: boolean
  needsCrossHostConnection?: boolean
  evidenceValid?: boolean
}): FindingStatus {
  if (opts.evidenceValid === false) return 'Invalid evidence'
  if (opts.needsCrossHostConnection || !opts.connectionPresent) {
    if (opts.autoFixable) return 'Connection required'
    return 'Human review required'
  }
  if (opts.autoFixable) return 'Auto-fixable'
  return 'Human review required'
}

export const FINDING_STATUS_HELP: Record<FindingStatus, string> = {
  'Auto-fixable': 'A deterministic fix exists. Approve to write.',
  'Human review required': 'Evidence exists; no safe auto write.',
  'Connection required': 'Connect write access for the exact hostname named in the finding.',
  Implemented: 'Write succeeded. Live verification not yet confirmed.',
  Verified: 'Independent live re-crawl matches the intended state.',
  'Awaiting Google recrawl':
    'Verified on our crawl. Google’s last recorded crawl still predates verification.',
  Failed: 'Write or verification failed — see stored reason.',
  'Invalid evidence': 'Stored crawl is unusable — run a fresh audit.',
}

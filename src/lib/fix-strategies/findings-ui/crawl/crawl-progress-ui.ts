/**
 * Pure helpers for Findings crawl progress UI (stall banner + status poll).
 * Kept free of React so unit tests can cover without a client bundle.
 */

import { WATCHDOG_NO_PROGRESS_MS } from '@/lib/run-heartbeat/heartbeat'

/** Poll crawl counters from GET while a run is in flight. */
export const CRAWL_STATUS_POLL_MS = 5_000

const WATCHDOG_FAIL_RE = /no progress for 15 minutes/i

export type CrawlProgressKind = 'stalled' | 'still_working' | 'normal'

export type CrawlProgressInput = {
  status: string | null | undefined
  errorDetail?: string | null
}

/**
 * "Crawl stalled" only after the 15m heartbeat watchdog fails the run.
 * While queued/running (even if a tick is slow), show Still working….
 */
export function crawlProgressKind(crawl: CrawlProgressInput): CrawlProgressKind {
  if (
    crawl.status === 'failed' &&
    WATCHDOG_FAIL_RE.test(String(crawl.errorDetail || ''))
  ) {
    return 'stalled'
  }
  if (crawl.status === 'running' || crawl.status === 'queued') {
    return 'still_working'
  }
  return 'normal'
}

export function crawlProgressLabel(crawl: CrawlProgressInput): string {
  const kind = crawlProgressKind(crawl)
  if (kind === 'stalled') return 'Crawl stalled'
  if (kind === 'still_working') return 'Still working…'
  if (!crawl.status) return 'No crawl yet'
  if (crawl.status === 'partial') return 'Partial coverage'
  if (crawl.status === 'complete') return 'Complete'
  if (crawl.status === 'failed') return 'Failed'
  return crawl.status
}

/** Watchdog window used by heartbeat — exported for UI copy/tests. */
export const CRAWL_WATCHDOG_MS = WATCHDOG_NO_PROGRESS_MS

/**
 * Engineering crawl chips (Cap / Chunk / rendered / internal count) are
 * master-only. Customers see Status, Duration, pages crawled, actionable,
 * and informational only.
 */
export function shouldShowEngineeringCrawlChips(
  canRunFixAgent: boolean | undefined | null,
): boolean {
  return canRunFixAgent === true
}

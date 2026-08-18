// src/lib/rank-warming-up.ts
// Step 5 of the hosted-publish task: "for the first 90 days after
// published_at, show a warming-up state, not a rank number — only ~1.7% of
// new pages reach the top 10 within a year; showing 'not ranking' on day 3
// is a lie about the product's job." Pure, testable, no DB access.

export const WARMING_UP_WINDOW_DAYS = 90

export function isWarmingUp(publishedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!publishedAt) return false
  const publishedMs = Date.parse(publishedAt)
  if (Number.isNaN(publishedMs)) return false
  const elapsedDays = (now.getTime() - publishedMs) / (1000 * 60 * 60 * 24)
  return elapsedDays >= 0 && elapsedDays < WARMING_UP_WINDOW_DAYS
}

export function daysUntilWarmingUpEnds(publishedAt: string, now: Date = new Date()): number {
  const publishedMs = Date.parse(publishedAt)
  const elapsedDays = (now.getTime() - publishedMs) / (1000 * 60 * 60 * 24)
  return Math.max(0, Math.ceil(WARMING_UP_WINDOW_DAYS - elapsedDays))
}

// Content-decay monitoring only begins once a page is LIVE_VERIFIED —
// CREATED/BUILD_PENDING/LIVE_UNVERIFIED/FAILED are all "not confirmed live
// yet" states where decay tracking has nothing real to measure against.
export function decayMonitoringEligible(publicationState: string | null | undefined): boolean {
  return publicationState === 'LIVE_VERIFIED'
}

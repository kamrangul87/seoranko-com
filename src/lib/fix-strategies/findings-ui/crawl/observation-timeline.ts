/**
 * Change Monitoring 3.1 — classify a URL's HTTP status series across runs.
 *
 * Never label "persistent" from a single observation.
 * Uses the same window product decision as topic-3 persistent-5xx when
 * deciding whether a streak of 5xx spans enough wall-clock time.
 */

import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

export type UrlObservationPattern =
  | 'insufficient'
  | 'transient'
  | 'persistent'
  | 'intermittent'
  | 'historical_resolved'

export type UrlObservationPoint = {
  httpStatus: number | null
  observedAtMs: number
}

function isErrorStatus(status: number | null): boolean {
  if (status == null) return true
  return status >= 400
}

function is5xx(status: number | null): boolean {
  return status != null && status >= 500 && status < 600
}

/**
 * Classify an ordered (oldest → newest) observation series for one URL.
 */
export function classifyUrlObservationPattern(
  points: UrlObservationPoint[],
  opts?: { persistentWindowMs?: number },
): UrlObservationPattern {
  if (points.length < 2) return 'insufficient'

  const windowMs =
    opts?.persistentWindowMs ??
    FIX_STRATEGY_PRODUCT_DECISIONS.persistent5xxObservationWindowMs

  const errors = points.map((p) => isErrorStatus(p.httpStatus))
  const allError = errors.every(Boolean)
  const noneError = errors.every((e) => !e)
  if (noneError) return 'insufficient'

  const firstError = errors[0]!
  const lastError = errors[errors.length - 1]!

  // error earlier, ok now
  if (firstError && !lastError) return 'historical_resolved'

  // ok earlier, then at least one error, then ok again — or error/ok alternating
  const sawOk = errors.some((e) => !e)
  const sawError = errors.some(Boolean)
  if (sawOk && sawError && !allError) {
    // Ended in error after having been ok → intermittent (not yet historical)
    if (lastError) return 'intermittent'
    return 'historical_resolved'
  }

  if (allError) {
    // Persistent only when 5xx streak spans the product window.
    const five = points.filter((p) => is5xx(p.httpStatus))
    if (five.length >= 2) {
      const span = five[five.length - 1]!.observedAtMs - five[0]!.observedAtMs
      if (span >= windowMs) return 'persistent'
    }
    // Multiple errors but window not spanned (or not 5xx) → transient streak
    return 'transient'
  }

  return 'transient'
}

export type UrlObservationRecord = {
  id: string
  runId: string
  siteId: string | null
  detectOrigin: string | null
  userId: string
  url: string
  finalUrl: string | null
  httpStatus: number | null
  redirectHops: string[]
  retryAfter: string | null
  durationMs: number | null
  observedAt: string
}

/**
 * Topic 3 — 5xx / availability responses (detect and report only).
 *
 * Finding is REPRODUCIBILITY, not occurrence:
 * - stableAcrossRefetch — both fetches in the re-fetch pair are 5xx-class
 * - transient — statuses differ across the pair
 * - historical — GSC-only; report with crawl date, never as current fault
 * - persistent-5xx — when observations span persistent5xxObservationWindowMs
 *   (product decision: 48h)
 *
 * No repo fix exists for a 5xx.
 */

import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'
import { parseRetryAfter } from '@/lib/fix-strategies/fetch/parse-retry-after'

export type Topic3Class =
  | 'stableAcrossRefetch'
  | 'transient-5xx'
  | 'historical-gsc'
  | 'timeout'
  | 'connection-failure'
  | 'persistent-5xx'
  | 'awaiting-retry-after'

export type Topic3Verdict =
  | 'report-stable-across-refetch'
  | 'record-transient'
  | 'report-historical-gsc'
  | 'record-timeout'
  | 'record-connection-failure'
  | 'report-persistent-5xx'
  | 'honour-retry-after'
  | 'suppress-single-observation'

export type Topic3Finding = {
  kind: 'status/5xx'
  verdict: Topic3Verdict
  classification: Topic3Class
  severity: null
  pageUrl: string
  detail: string
  autoFixable: false
  /** Statuses observed (null = non-HTTP). */
  statuses: Array<number | null>
  /** GSC crawl date when historical. */
  gscCrawlDate: string | null
  /** Retry-After delay honoured (ms), if any. */
  retryAfterMsHonoured: number | null
}

export type DetectTopic3Result = {
  findings: Topic3Finding[]
  suppressed: Array<{ verdict: Topic3Verdict; detail: string }>
}

export type FetchAttemptRecord = {
  /** HTTP status, or null for non-HTTP. */
  status: number | null
  kind?: 'http' | 'timeout' | 'connection-reset' | 'dns-failure' | 'network'
  headers?: Headers
  observedAtMs?: number
}

export type DetectTopic3Options = {
  pageUrl: string
  /**
   * Re-fetch pair (or more). A single observation never reports a fault.
   */
  attempts: FetchAttemptRecord[]
  /**
   * GSC Server error (5xx) historical signal. When live attempts are 200
   * but GSC recorded an error, report historical with this date.
   */
  gscServerErrorCrawlDate?: string | null
  /** Live status when contrasting with GSC (defaults to last attempt). */
  liveStatus?: number | null
  nowMs?: number
  /**
   * The most recent PRIOR crawl run's recorded status for this exact URL,
   * if that run also observed a 5xx here. The live re-fetch pair alone
   * (seconds apart) can never span persistent5xxObservationWindowMs
   * (48h) — this is the real cross-run signal that makes persistent-5xx
   * reachable from actual crawl data instead of only from a synthetic
   * test that fabricates both attempts' observedAtMs.
   */
  priorObservation?: { status: number | null; observedAtMs: number } | null
}

function is5xxClass(a: FetchAttemptRecord): boolean {
  if (a.kind && a.kind !== 'http') return false
  return a.status != null && a.status >= 500 && a.status < 600
}

function isAvailabilityNonHttp(a: FetchAttemptRecord): boolean {
  return (
    a.kind === 'timeout' ||
    a.kind === 'connection-reset' ||
    a.kind === 'dns-failure' ||
    a.kind === 'network'
  )
}

function sameAvailabilityClass(a: FetchAttemptRecord, b: FetchAttemptRecord): boolean {
  if (is5xxClass(a) && is5xxClass(b)) return true
  if (a.kind && a.kind === b.kind && a.kind !== 'http') return true
  if (a.status != null && a.status === b.status) return true
  return false
}

/** No repo fix for a 5xx. */
export function rejectedRepoFixFor5xx(): never {
  throw new Error(
    'topic 3: no deterministic repo transform exists for a 5xx — detect/report only',
  )
}

/** Never report GSC 5xx as a current fault. */
export function rejectedGscAsCurrentFault(): never {
  throw new Error(
    'topic 3: GSC Server error (5xx) is historical — report with crawl date, never as current',
  )
}

export function detect5xxResponses(
  options: DetectTopic3Options,
): DetectTopic3Result {
  const findings: Topic3Finding[] = []
  const suppressed: DetectTopic3Result['suppressed'] = []
  const attempts = options.attempts
  const statuses = attempts.map((a) => a.status)

  // Historical GSC-only
  if (options.gscServerErrorCrawlDate) {
    const live =
      options.liveStatus ??
      attempts[attempts.length - 1]?.status ??
      null
    if (live != null && live >= 200 && live < 400) {
      findings.push({
        kind: 'status/5xx',
        verdict: 'report-historical-gsc',
        classification: 'historical-gsc',
        severity: null,
        pageUrl: options.pageUrl,
        detail: `Historical GSC server error from crawl ${options.gscServerErrorCrawlDate}; live status ${live} — not a current fault`,
        autoFixable: false,
        statuses,
        gscCrawlDate: options.gscServerErrorCrawlDate,
        retryAfterMsHonoured: null,
      })
      return { findings, suppressed }
    }
  }

  if (attempts.length === 0) {
    return { findings, suppressed }
  }

  if (attempts.length === 1) {
    suppressed.push({
      verdict: 'suppress-single-observation',
      detail: 'Single observation only — re-fetch first (topic 68)',
    })
    return { findings, suppressed }
  }

  const first = attempts[0]!
  const second = attempts[1]!

  // Honour Retry-After on 503/429 before concluding (fixture: third case)
  let retryAfterMsHonoured: number | null = null
  if (
    first.kind !== 'timeout' &&
    first.status != null &&
    (first.status === 503 || first.status === 429) &&
    first.headers
  ) {
    const raw = first.headers.get('retry-after')
    const parsed = parseRetryAfter(raw, options.nowMs ?? Date.now())
    if (parsed != null) {
      retryAfterMsHonoured = parsed
      // Caller is expected to have waited; we record that the header was present.
      findings.push({
        kind: 'status/5xx',
        verdict: 'honour-retry-after',
        classification: 'awaiting-retry-after',
        severity: null,
        pageUrl: options.pageUrl,
        detail: `Retry-After present (${parsed}ms) — must be honoured before classifying`,
        autoFixable: false,
        statuses,
        gscCrawlDate: null,
        retryAfterMsHonoured,
      })
    }
  }

  // Timeout — not a 500
  if (first.kind === 'timeout' || second.kind === 'timeout') {
    if (first.kind === 'timeout' && second.kind === 'timeout') {
      findings.push({
        kind: 'status/5xx',
        verdict: 'record-timeout',
        classification: 'timeout',
        severity: null,
        pageUrl: options.pageUrl,
        detail: 'Connection timeout on re-fetch pair — recorded as timeout, not as a 5xx status code',
        autoFixable: false,
        statuses,
        gscCrawlDate: null,
        retryAfterMsHonoured,
      })
      return { findings, suppressed }
    }
  }

  if (
    isAvailabilityNonHttp(first) ||
    isAvailabilityNonHttp(second)
  ) {
    if (
      first.kind &&
      first.kind === second.kind &&
      first.kind !== 'http'
    ) {
      findings.push({
        kind: 'status/5xx',
        verdict: 'record-connection-failure',
        classification: 'connection-failure',
        severity: null,
        pageUrl: options.pageUrl,
        detail: `Availability failure (${first.kind}) stable across re-fetch — not an HTTP 500 code`,
        autoFixable: false,
        statuses,
        gscCrawlDate: null,
        retryAfterMsHonoured,
      })
      return { findings, suppressed }
    }
  }

  // Transient — differing statuses
  if (!sameAvailabilityClass(first, second)) {
    findings.push({
      kind: 'status/5xx',
      verdict: 'record-transient',
      classification: 'transient-5xx',
      severity: null,
      pageUrl: options.pageUrl,
      detail: `Transient: statuses differ across re-fetch pair (${first.status}/${first.kind ?? 'http'} → ${second.status}/${second.kind ?? 'http'}) — not reported as a site fault`,
      autoFixable: false,
      statuses,
      gscCrawlDate: null,
      retryAfterMsHonoured,
    })
    return { findings, suppressed }
  }

  // Stable across refetch (both 5xx-class)
  if (is5xxClass(first) && is5xxClass(second)) {
    const windowMs =
      FIX_STRATEGY_PRODUCT_DECISIONS.persistent5xxObservationWindowMs

    findings.push({
      kind: 'status/5xx',
      verdict: 'report-stable-across-refetch',
      classification: 'stableAcrossRefetch',
      severity: null,
      pageUrl: options.pageUrl,
      detail: `stableAcrossRefetch: ${first.status} on both fetches of the re-fetch pair`,
      autoFixable: false,
      statuses,
      gscCrawlDate: null,
      retryAfterMsHonoured,
    })

    // persistent-5xx only when product window is set AND satisfied — by
    // either of two independent sources of a real time span:
    //  (a) the caller's own attempts already span the window (a caller
    //      that itself polls over real time, not just the topic-68
    //      re-fetch pair), or
    //  (b) a prior crawl run's observation of this same URL, supplied by
    //      the caller as priorObservation — this is what the live crawl
    //      pipeline actually wires in, since one run's re-fetch pair is
    //      always seconds apart, never 48h.
    const windowSet = typeof windowMs === 'number' && windowMs > 0
    const spanFromAttempts =
      windowSet &&
      first.observedAtMs != null &&
      second.observedAtMs != null &&
      Math.abs(second.observedAtMs - first.observedAtMs) >= windowMs

    const prior = options.priorObservation
    const priorIs5xx =
      prior != null && prior.status != null && prior.status >= 500 && prior.status < 600
    const spanFromPriorRun =
      windowSet &&
      priorIs5xx &&
      second.observedAtMs != null &&
      Math.abs(second.observedAtMs - prior!.observedAtMs) >= windowMs

    if (spanFromAttempts || spanFromPriorRun) {
      findings.push({
        kind: 'status/5xx',
        verdict: 'report-persistent-5xx',
        classification: 'persistent-5xx',
        severity: null,
        pageUrl: options.pageUrl,
        detail: spanFromPriorRun
          ? `persistent-5xx: also 5xx (${prior!.status}) in a prior crawl run, ${Math.round(
              Math.abs((second.observedAtMs ?? 0) - prior!.observedAtMs) / 3_600_000,
            )}h apart — spans the ${Math.round(windowMs / 3_600_000)}h observation window`
          : `persistent-5xx: stable across observation window (${windowMs}ms) — product decision`,
        autoFixable: false,
        statuses,
        gscCrawlDate: null,
        retryAfterMsHonoured,
      })
    }

    return { findings, suppressed }
  }

  return { findings, suppressed }
}

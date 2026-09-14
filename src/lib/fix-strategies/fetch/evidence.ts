import { FETCH_EVIDENCE_CONFIG } from './config'
import { fetchUrl } from './fetch-url'
import { parseRetryAfter } from './parse-retry-after'
import type { EvidenceResult, FetchDeps, FetchOutcome } from './types'

function outcomeKey(outcome: FetchOutcome): string {
  if (outcome.kind === 'http') return `http:${outcome.status}`
  return outcome.kind
}

function isRetryableAvailability(outcome: FetchOutcome): boolean {
  if (outcome.kind !== 'http') return true
  return (
    outcome.status === 429 ||
    outcome.status === 503 ||
    outcome.statusClass === '5xx-other'
  )
}

function needsConfirmingRefetch(outcome: FetchOutcome): boolean {
  return (
    outcome.kind === 'http' &&
    (outcome.status === 404 || outcome.statusClass === '4xx-other')
  )
}

function waitMsFor(
  outcome: FetchOutcome,
  deps: FetchDeps,
  maxRetryAfterMs: number,
  fallbackDelayMs: number,
): number {
  if (outcome.kind !== 'http') return Math.min(fallbackDelayMs, maxRetryAfterMs)
  if (outcome.status !== 429 && outcome.status !== 503) {
    return Math.min(fallbackDelayMs, maxRetryAfterMs)
  }
  const raw = outcome.headers.get('retry-after')
  const parsed = parseRetryAfter(raw, deps.now())
  const base = parsed == null ? fallbackDelayMs : parsed
  return Math.min(base, maxRetryAfterMs)
}

/**
 * Topic 68 evidence gate.
 *
 * - 410: permanence asserted by the server — one observation is enough.
 * - 404 / other 4xx (except 429): same status must be seen on a cache-bypassing
 *   re-fetch before a finding may fire.
 * - 429 / 503: honour Retry-After (or fallback); never raise as a link finding.
 * - other 5xx / network failures: retry then suppress as non-actionable.
 * - differing statuses across attempts → unstable, suppress.
 */
export async function fetchWithEvidence(
  url: string,
  deps: FetchDeps,
): Promise<EvidenceResult> {
  const config = { ...FETCH_EVIDENCE_CONFIG, ...deps.config }
  const attempts: FetchOutcome[] = []

  const first = await fetchUrl(url, deps, { bypassCache: true })
  attempts.push(first)

  // 410 — single observation sufficient (RFC 9110 §15.5.11 permanence claim).
  if (first.kind === 'http' && first.status === 410) {
    return { stable: true, outcome: first, attempts }
  }

  if (
    first.kind === 'http' &&
    (first.statusClass === '2xx' || first.statusClass === '3xx')
  ) {
    return { stable: true, outcome: first, attempts }
  }

  const shouldContinue =
    needsConfirmingRefetch(first) || isRetryableAvailability(first)

  if (!shouldContinue) {
    return { stable: true, outcome: first, attempts }
  }

  for (let attempt = 2; attempt <= config.maxAttempts; attempt++) {
    const previous = attempts[attempts.length - 1]!
    const delay = waitMsFor(
      previous,
      deps,
      config.maxRetryAfterMs,
      config.fallbackDelayMs,
    )
    if (delay > 0) await deps.sleep(delay)

    const next = await fetchUrl(url, deps, { bypassCache: true })
    attempts.push(next)

    if (outcomeKey(next) !== outcomeKey(attempts[0]!)) {
      return { stable: false, reason: 'unstable-status', attempts }
    }
  }

  const last = attempts[attempts.length - 1]!

  if (needsConfirmingRefetch(last)) {
    return { stable: true, outcome: last, attempts }
  }

  if (last.kind === 'http' && last.status === 410) {
    return { stable: true, outcome: last, attempts }
  }

  return { stable: false, reason: 'non-actionable', attempts }
}

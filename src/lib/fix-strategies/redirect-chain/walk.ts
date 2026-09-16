/**
 * ONE chain-walk result for topics 4–7.
 *
 * Walk once via hop-recording-fetch; all four topics classify from this
 * object — never re-walk.
 */

import {
  recordRedirectHops,
  type HopRecordingDeps,
  type HopRecordingResult,
  type HopStoppedReason,
  type RedirectHop,
  normalizeHopUrl,
} from '@/lib/fix-strategies/shared/hop-recording-fetch'

export type ChainWalkResult = {
  originUrl: string
  hops: RedirectHop[]
  /** Number of 3xx responses in the chain (hop count for topic 4 bands). */
  redirectHopCount: number
  stoppedReason: HopStoppedReason
  finalUrl: string
  finalStatus: number
  finalBody: string
  finalHeaders: Headers
  visitedNormalized: string[]
  /** Full cycle of normalised URLs when stoppedReason is repeat-url. */
  cycle: string[] | null
  /** True when a single hop redirects to itself (A → A). */
  selfRedirect: boolean
  /** True when a 3xx hop has no Location. */
  missingLocation: boolean
  raw: HopRecordingResult
}

export async function walkRedirectChain(
  originUrl: string,
  deps: HopRecordingDeps,
  opts?: { maxHops?: number; readFinalBody?: boolean },
): Promise<ChainWalkResult> {
  const raw = await recordRedirectHops(originUrl, deps, opts)
  const redirectHopCount = raw.hops.filter(
    (h) => h.status >= 300 && h.status < 400,
  ).length

  const missingLocation = raw.stoppedReason === 'missing-location'

  let cycle: string[] | null = null
  let selfRedirect = false

  if (raw.stoppedReason === 'repeat-url') {
    cycle = extractCycle(raw.visitedNormalized)
    selfRedirect =
      redirectHopCount === 1 &&
      raw.hops[0] != null &&
      raw.hops[0].location != null &&
      normalizeHopUrl(raw.hops[0].url) ===
        normalizeHopUrl(raw.hops[0].location, raw.hops[0].url)
  }

  return {
    originUrl,
    hops: raw.hops,
    redirectHopCount,
    stoppedReason: raw.stoppedReason,
    finalUrl: raw.finalUrl,
    finalStatus: raw.finalStatus,
    finalBody: raw.finalBody,
    finalHeaders: raw.finalHeaders,
    visitedNormalized: raw.visitedNormalized,
    cycle,
    selfRedirect,
    missingLocation,
    raw,
  }
}

/**
 * Extract the looping cycle from the visited-normalised list.
 * The last entry repeats an earlier one; cycle is from that earlier index
 * through the end (inclusive of the repeat key once).
 */
function extractCycle(visitedNormalized: string[]): string[] {
  if (visitedNormalized.length === 0) return []
  const last = visitedNormalized[visitedNormalized.length - 1]!
  const firstIdx = visitedNormalized.indexOf(last)
  if (firstIdx < 0) return [last]
  // Include from first occurrence through the closing repeat
  return visitedNormalized.slice(firstIdx)
}

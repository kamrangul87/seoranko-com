// src/lib/rank-trigger.ts
// §10 item 5 / §6.4 — trigger logic for the Ranking Agent.
//
// Replaces three defects in the previous implementation:
//   1. Velocity was last-minus-first. The old computeVelocity averaged
//      consecutive deltas, which telescopes to (first − last)/(n−1) — the same
//      number, so [20,17,14,11], [20,9,22,11] and [20,20,20,11] all returned
//      3.00 despite completely different trajectories. Now a fitted slope.
//   2. A fixed drop-of-3 threshold. §6.4: "roughly right at the top and badly
//      wrong at the bottom" — position 50 wobbles several places daily as
//      normal behaviour. Thresholds now scale with band.
//   3. Fired on a single observation. Now requires k consecutive checks.
//
// SIGN CONVENTION (§6.4): position is 1 = best. A POSITIVE slope means the
// number is rising, i.e. the page is getting WORSE. Negative Δposition is good.
// NOTE: `ranking_agent_articles.position_change` currently uses the opposite
// convention (positive = improved). Reconciling that is §10 item 10; this
// module deliberately does not depend on that column.

export type Band = '1-3' | '4-10' | '11-20' | '21-50' | '51+'

export function bandFor(position: number | null): Band | null {
  if (position == null) return null
  if (position <= 3) return '1-3'
  if (position <= 10) return '4-10'
  if (position <= 20) return '11-20'
  if (position <= 50) return '21-50'
  return '51+'
}

/**
 * Declared priors, not fitted values (§6.6: "Fit it or declare it a prior").
 * Units: positions of sustained slope per check. §6.4 requires these be
 * re-estimated empirically as the stdev of untreated units per band once
 * rank_checks has accumulated data — see §10 day-8 review.
 */
export const NOISE_THRESHOLD_PRIOR: Record<Band, number> = {
  '1-3': 1.0,
  '4-10': 2.0,
  '11-20': 3.5,
  '21-50': 6.0,
  '51+': 10.0
}

/**
 * Google's own core-update guidance, stated as a prior (§6.4): a small drop
 * (2 → 4) warrants no action, and it advises against changing content that is
 * already performing well. The burden of proof rises the better the page does.
 */
export const MIN_DROP_TO_ACT: Record<Band, number> = {
  '1-3': 5,
  '4-10': 6,
  '11-20': 8,
  '21-50': 12,
  '51+': 20
}

export const CONSECUTIVE_CHECKS_REQUIRED = 2

export interface RankObservation {
  position: number | null
  checkedAt: string
}

/**
 * Least-squares slope of position against time, in positions per check.
 * Positive = worsening. Returns null when there isn't enough signal.
 */
export function fittedSlope(history: RankObservation[], window = 6): number | null {
  const pts = history
    .filter(h => h.position != null)
    .sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime())
    .slice(-window)

  if (pts.length < 3) return null   // two points is a line, not a trend

  const n = pts.length
  const meanX = (n - 1) / 2
  const meanY = pts.reduce((s, p) => s + p.position!, 0) / n

  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (pts[i].position! - meanY)
    den += (i - meanX) ** 2
  }
  return den === 0 ? null : num / den
}

export interface TriggerDecision {
  fired: boolean
  reason: string
  slope: number | null
  band: Band | null
  consecutiveWorsening: number
  noiseThreshold: number | null
  totalDrop: number | null
}

/**
 * Decide whether the agent should act. Refusing is a valid, common outcome —
 * §6.3: "Doing nothing is a valid output."
 */
export function evaluateTrigger(history: RankObservation[]): TriggerDecision {
  const valid = history
    .filter(h => h.position != null)
    .sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime())

  const current = valid.length ? valid[valid.length - 1].position! : null
  const band = bandFor(current)

  const base = {
    slope: null as number | null,
    band,
    consecutiveWorsening: 0,
    noiseThreshold: band ? NOISE_THRESHOLD_PRIOR[band] : null,
    totalDrop: null as number | null
  }

  if (valid.length < 3) {
    return { ...base, fired: false, reason: 'Not enough rank history yet — need at least 3 checks.' }
  }

  const slope = fittedSlope(valid)
  if (slope == null) {
    return { ...base, fired: false, reason: 'Could not fit a trend to this history.' }
  }

  // Consecutive checks where position got worse (number went up).
  let consecutive = 0
  for (let i = valid.length - 1; i > 0; i--) {
    if (valid[i].position! > valid[i - 1].position!) consecutive++
    else break
  }

  const threshold = band ? NOISE_THRESHOLD_PRIOR[band] : NOISE_THRESHOLD_PRIOR['21-50']
  const best = Math.min(...valid.map(v => v.position!))
  const totalDrop = current != null ? current - best : null
  const minDrop = band ? MIN_DROP_TO_ACT[band] : MIN_DROP_TO_ACT['21-50']

  const decision = { ...base, slope, consecutiveWorsening: consecutive, noiseThreshold: threshold, totalDrop }

  if (slope <= 0) {
    return { ...decision, fired: false, reason: `Position is stable or improving (slope ${slope.toFixed(2)}/check).` }
  }
  if (consecutive < CONSECUTIVE_CHECKS_REQUIRED) {
    return { ...decision, fired: false, reason: `Only ${consecutive} consecutive worsening check(s); ${CONSECUTIVE_CHECKS_REQUIRED} required.` }
  }
  if (slope < threshold) {
    return { ...decision, fired: false, reason: `Slope ${slope.toFixed(2)}/check is within normal noise for band ${band} (threshold ${threshold}).` }
  }
  if (totalDrop != null && totalDrop < minDrop) {
    return { ...decision, fired: false, reason: `Drop of ${totalDrop} from best (${best}) is below the ${minDrop}-position bar for band ${band} — Google advises against changing pages that slipped only slightly.` }
  }

  return {
    ...decision,
    fired: true,
    reason: `Sustained decline: slope ${slope.toFixed(2)}/check over ${valid.length} checks, ${consecutive} consecutive worsening, down ${totalDrop} from best (${best}) in band ${band}.`
  }
}

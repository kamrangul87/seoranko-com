/**
 * Mechanical baseline readiness for Causal Experiment Engine PR1.
 * Pure assertions + stored numeric evidence — no LLM judgments.
 */

export type BaselineReasonCode =
  | 'insufficient_urls_with_impressions'
  | 'insufficient_baseline_days'
  | 'too_many_zero_impression_urls'
  | 'traffic_discontinuity'
  | 'ready'

export type BaselineReadinessEvidence = {
  candidateSet: 'gsc_reported_urls'
  baselineStart: string | null
  baselineEnd: string | null
  usableDayCount: number
  minDaysRequired: number
  urlCountWithImpressions: number
  minUrlsRequired: number
  candidateUrlCount: number
  zeroImpressionUrlCount: number
  zeroImpressionRatio: number
  maxZeroImpressionRatio: number
  totalImpressions: number
  medianAvgPosition: number | null
  discontinuity?: {
    dropDate: string
    previousDate: string
    previousImpressions: number
    dropImpressions: number
    dropRatio: number
    recoveredWithinDays: number
  } | null
}

export type BaselineReadinessResult = {
  passed: boolean
  reasonCode: BaselineReasonCode
  evidence: BaselineReadinessEvidence
}

export type DailyUrlMetric = {
  url: string
  date: string
  impressions: number
  clicks: number
  avg_position: number
  is_final: boolean
}

const MIN_URLS = 30
const MIN_DAYS = 56
const MAX_ZERO_RATIO = 0.4
const DROP_THRESHOLD = 0.5
/** Ignore day-over-day drops when the prior day was too small to be meaningful. */
const DISCONTINUITY_MIN_PREV_IMPRESSIONS = 100
/** Require an absolute impression drop — ratio alone fires on noise (e.g. 10→1). */
const DISCONTINUITY_MIN_ABSOLUTE_DROP = 50
const RECOVERY_DAYS = 7
const RECOVERY_LEVEL = 0.8

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function findTrafficDiscontinuity(
  dayTotals: Array<{ date: string; impressions: number }>,
): BaselineReadinessEvidence['discontinuity'] {
  for (let i = 1; i < dayTotals.length; i++) {
    const prev = dayTotals[i - 1]
    const cur = dayTotals[i]
    if (prev.impressions < DISCONTINUITY_MIN_PREV_IMPRESSIONS) continue
    const absoluteDrop = prev.impressions - cur.impressions
    if (absoluteDrop < DISCONTINUITY_MIN_ABSOLUTE_DROP) continue
    if (cur.impressions >= prev.impressions * DROP_THRESHOLD) continue

    const window = dayTotals.slice(i + 1, i + 1 + RECOVERY_DAYS)
    // Incomplete recovery window near series end — do not fail yet.
    if (window.length < RECOVERY_DAYS) continue

    const recovered = window.some((d) => d.impressions >= prev.impressions * RECOVERY_LEVEL)
    if (!recovered) {
      return {
        dropDate: cur.date,
        previousDate: prev.date,
        previousImpressions: prev.impressions,
        dropImpressions: cur.impressions,
        dropRatio: cur.impressions / prev.impressions,
        recoveredWithinDays: RECOVERY_DAYS,
      }
    }
  }
  return null
}

/**
 * Evaluate whether a site has enough clean baseline signal to run an experiment.
 * Only `is_final` rows are used (GSC lag window excluded).
 */
export function evaluateBaselineReadiness(
  rows: DailyUrlMetric[],
  opts?: { minUrlsRequired?: number; minDaysRequired?: number },
): BaselineReadinessResult {
  const minUrlsRequired = opts?.minUrlsRequired ?? MIN_URLS
  const minDaysRequired = opts?.minDaysRequired ?? MIN_DAYS
  if (minUrlsRequired <= 0) throw new Error('minUrlsRequired must be a positive number')
  if (minDaysRequired <= 0) throw new Error('minDaysRequired must be a positive number')

  const finalRows = rows.filter((r) => r.is_final)
  const byDate = new Map<string, number>()
  const byUrl = new Map<string, number>()
  const positions: number[] = []
  let totalImpressions = 0

  for (const r of finalRows) {
    byDate.set(r.date, (byDate.get(r.date) || 0) + (r.impressions || 0))
    byUrl.set(r.url, (byUrl.get(r.url) || 0) + (r.impressions || 0))
    totalImpressions += r.impressions || 0
    if (r.impressions > 0 && Number.isFinite(r.avg_position)) {
      positions.push(r.avg_position)
    }
  }

  const dates = Array.from(byDate.keys()).sort()
  const baselineStart = dates[0] || null
  const baselineEnd = dates.length ? dates[dates.length - 1]! : null
  const usableDayCount = dates.length
  const candidateUrlCount = byUrl.size
  const urlCountWithImpressions = Array.from(byUrl.values()).filter((v) => v > 0).length
  const zeroImpressionUrlCount = candidateUrlCount - urlCountWithImpressions
  const zeroImpressionRatio =
    candidateUrlCount === 0 ? 1 : zeroImpressionUrlCount / candidateUrlCount

  const dayTotals = dates.map((date) => ({ date, impressions: byDate.get(date) || 0 }))
  const discontinuity = findTrafficDiscontinuity(dayTotals)

  const evidence: BaselineReadinessEvidence = {
    candidateSet: 'gsc_reported_urls',
    baselineStart,
    baselineEnd,
    usableDayCount,
    minDaysRequired,
    urlCountWithImpressions,
    minUrlsRequired,
    candidateUrlCount,
    zeroImpressionUrlCount,
    zeroImpressionRatio,
    maxZeroImpressionRatio: MAX_ZERO_RATIO,
    totalImpressions,
    medianAvgPosition: median(positions),
    discontinuity,
  }

  if (urlCountWithImpressions < minUrlsRequired) {
    return { passed: false, reasonCode: 'insufficient_urls_with_impressions', evidence }
  }
  if (usableDayCount < minDaysRequired) {
    return { passed: false, reasonCode: 'insufficient_baseline_days', evidence }
  }
  if (zeroImpressionRatio > MAX_ZERO_RATIO) {
    return { passed: false, reasonCode: 'too_many_zero_impression_urls', evidence }
  }
  if (discontinuity) {
    return { passed: false, reasonCode: 'traffic_discontinuity', evidence }
  }

  return { passed: true, reasonCode: 'ready', evidence }
}

export function reasonCodeLabel(code: BaselineReasonCode): string {
  switch (code) {
    case 'insufficient_urls_with_impressions':
      return 'Fewer than 30 URLs have any impressions in the baseline window'
    case 'insufficient_baseline_days':
      return 'Fewer than 56 days of usable (final) baseline data'
    case 'too_many_zero_impression_urls':
      return 'More than 40% of candidate URLs have zero impressions across the window'
    case 'traffic_discontinuity':
      return 'Site-wide traffic discontinuity detected (prior day ≥100 impressions, absolute drop ≥50, and day-over-day drop >50% without recovery in 7 days)'
    case 'ready':
      return 'Baseline ready'
    default:
      return code
  }
}

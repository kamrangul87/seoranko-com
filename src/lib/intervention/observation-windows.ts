/**
 * Observation window resolver over url_metrics_daily.
 * No separate outcome_observations table — windows are derived queries.
 */

import type { DailyUrlMetric } from '@/lib/gsc/baseline-readiness'
import type { PrimaryMetric } from '@/lib/intervention/preregistration'

export type ObservationWindow = {
  baseline_period_start: string
  baseline_period_end: string
  observation_period_start: string
  observation_period_end: string
  baseline_window_days: number
  observation_window_days: number
}

export type DailyMetricPoint = {
  date: string
  /** Missing GSC days stay null — never coerced to 0. */
  value: number | null
  is_final: boolean
}

export type UrlWindowSeries = {
  url: string
  baseline: DailyMetricPoint[]
  observation: DailyMetricPoint[]
  missingBaselineDays: number
  missingObservationDays: number
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return toDateOnly(d)
}

function enumerateDays(start: string, end: string): string[] {
  const out: string[] = []
  let cur = start
  while (cur <= end) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

/**
 * Resolve baseline + observation windows from a verified intervention timestamp.
 * Baseline ends the day before applied_at; observation starts the day of applied_at.
 */
export function resolveObservationWindows(opts: {
  appliedAt: string | Date
  baselineWindowDays: number
  observationWindowDays: number
}): ObservationWindow {
  if (opts.baselineWindowDays <= 0) throw new Error('baselineWindowDays must be positive')
  if (opts.observationWindowDays <= 0) throw new Error('observationWindowDays must be positive')

  const applied =
    opts.appliedAt instanceof Date ? opts.appliedAt : new Date(opts.appliedAt)
  if (Number.isNaN(applied.getTime())) throw new Error('appliedAt is invalid')

  const appliedDay = toDateOnly(applied)
  const observationStart = appliedDay
  const observationEnd = addDays(observationStart, opts.observationWindowDays - 1)
  const baselineEnd = addDays(appliedDay, -1)
  const baselineStart = addDays(baselineEnd, -(opts.baselineWindowDays - 1))

  return {
    baseline_period_start: baselineStart,
    baseline_period_end: baselineEnd,
    observation_period_start: observationStart,
    observation_period_end: observationEnd,
    baseline_window_days: opts.baselineWindowDays,
    observation_window_days: opts.observationWindowDays,
  }
}

export function metricValueFromRow(
  row: Pick<DailyUrlMetric, 'impressions' | 'clicks' | 'avg_position'> & { ctr?: number },
  metric: PrimaryMetric,
): number {
  switch (metric) {
    case 'impressions':
      return row.impressions
    case 'clicks':
      return row.clicks
    case 'ctr':
      if (typeof row.ctr === 'number') return row.ctr
      return row.impressions > 0 ? row.clicks / row.impressions : 0
    case 'average_position':
      return row.avg_position
    default:
      return row.impressions
  }
}

/**
 * Build per-URL series for a window. Days with no row → value null (never 0).
 * Only `is_final` rows count as present observations.
 */
export function buildUrlWindowSeries(opts: {
  url: string
  rows: Array<
    DailyUrlMetric & {
      ctr?: number
    }
  >
  window: ObservationWindow
  metric: PrimaryMetric
}): UrlWindowSeries {
  const byDate = new Map<string, DailyUrlMetric & { ctr?: number }>()
  for (const r of opts.rows) {
    if (r.url !== opts.url) continue
    byDate.set(r.date, r)
  }

  const mapRange = (start: string, end: string): DailyMetricPoint[] => {
    return enumerateDays(start, end).map((date) => {
      const row = byDate.get(date)
      if (!row || !row.is_final) {
        return { date, value: null, is_final: false }
      }
      return {
        date,
        value: metricValueFromRow(row, opts.metric),
        is_final: true,
      }
    })
  }

  const baseline = mapRange(opts.window.baseline_period_start, opts.window.baseline_period_end)
  const observation = mapRange(
    opts.window.observation_period_start,
    opts.window.observation_period_end,
  )

  return {
    url: opts.url,
    baseline,
    observation,
    missingBaselineDays: baseline.filter((p) => p.value === null).length,
    missingObservationDays: observation.filter((p) => p.value === null).length,
  }
}

export function meanOfPresent(points: DailyMetricPoint[]): number | null {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

/** True when every day in the observation window has a final GSC row. */
export function observationWindowComplete(series: UrlWindowSeries): boolean {
  return series.missingObservationDays === 0 && series.observation.length > 0
}

export function hasMissingGscData(seriesList: UrlWindowSeries[]): boolean {
  return seriesList.some((s) => s.missingBaselineDays > 0 || s.missingObservationDays > 0)
}

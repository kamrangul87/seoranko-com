import type { DailyUrlMetric } from '@/lib/gsc/baseline-readiness'
import {
  resolveObservationWindows,
  buildUrlWindowSeries,
  meanOfPresent,
  sumOfPresent,
} from '@/lib/intervention/observation-windows'

export type BeforeAfter = {
  baseline: {
    impressions: number
    clicks: number
    avg_position: number | null
  }
  observation: {
    impressions: number
    clicks: number
    avg_position: number | null
  }
  missingObservationDays: number
  totalObservationDays: number
  requiredObservationDays: number
}

export function computeBeforeAfterForUrl(opts: {
  url: string
  rows: Array<DailyUrlMetric & { ctr?: number }>
  appliedAt: string | Date
  baselineDays?: number
  observationDays?: number
}): BeforeAfter {
  const baselineDays = opts.baselineDays ?? 28
  const observationDays = opts.observationDays ?? 28
  const window = resolveObservationWindows({
    appliedAt: opts.appliedAt,
    baselineWindowDays: baselineDays,
    observationWindowDays: observationDays,
  })
  const impressionsSeries = buildUrlWindowSeries({
    url: opts.url,
    rows: opts.rows,
    window,
    metric: 'impressions',
  })
  const clicksSeries = buildUrlWindowSeries({
    url: opts.url,
    rows: opts.rows,
    window,
    metric: 'clicks',
  })
  const posSeries = buildUrlWindowSeries({
    url: opts.url,
    rows: opts.rows,
    window,
    metric: 'average_position',
  })
  return {
    baseline: {
      impressions: sumOfPresent(impressionsSeries.baseline),
      clicks: sumOfPresent(clicksSeries.baseline),
      avg_position: meanOfPresent(posSeries.baseline),
    },
    observation: {
      impressions: sumOfPresent(impressionsSeries.observation),
      clicks: sumOfPresent(clicksSeries.observation),
      avg_position: meanOfPresent(posSeries.observation),
    },
    missingObservationDays: posSeries.missingObservationDays,
    totalObservationDays: posSeries.observation.length,
    requiredObservationDays: observationDays,
  }
}


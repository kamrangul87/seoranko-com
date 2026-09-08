/**
 * Experiment pre-registration — locks analysis plan before intervention lands.
 */

import { createHash } from 'crypto'

export type PrimaryMetric = 'impressions' | 'clicks' | 'ctr' | 'average_position'
export type ExpectedDirection = 'increase' | 'decrease' | 'no_prediction'
export type AnalysisMethod = 'difference_in_differences'

export type PreregistrationFields = {
  primary_metric: PrimaryMetric
  expected_direction: ExpectedDirection
  baseline_window_days: number
  observation_window_days: number
  analysis_method: AnalysisMethod
  minimum_detectable_effect: number | null
}

const PRIMARY_METRICS: readonly PrimaryMetric[] = [
  'impressions',
  'clicks',
  'ctr',
  'average_position',
]

export function isPrimaryMetric(value: string): value is PrimaryMetric {
  return (PRIMARY_METRICS as readonly string[]).includes(value)
}

/** Hash of locked fields — stored as preregistration_hash. */
export function hashPreregistration(fields: PreregistrationFields): string {
  const payload = {
    primary_metric: fields.primary_metric,
    expected_direction: fields.expected_direction,
    baseline_window_days: fields.baseline_window_days,
    observation_window_days: fields.observation_window_days,
    analysis_method: fields.analysis_method,
    minimum_detectable_effect: fields.minimum_detectable_effect,
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

/**
 * Analysis refuses a non-primary metric for the primary (non-exploratory) result.
 * Secondary metrics may still be computed when `exploratory: true`.
 */
export function assertAnalysisMetricAllowed(
  registeredPrimary: PrimaryMetric,
  requestedMetric: string,
  opts?: { exploratory?: boolean },
): void {
  if (opts?.exploratory) return
  if (requestedMetric !== registeredPrimary) {
    throw new Error(
      `Analysis refused: requested metric "${requestedMetric}" is not the locked primary_metric "${registeredPrimary}"`,
    )
  }
}

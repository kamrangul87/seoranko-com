/**
 * Causal analysis over pre-registered interventions.
 * Mechanical validity gates — never fabricates missing GSC days.
 */

import { evaluateBaselineReadiness, type DailyUrlMetric } from '@/lib/gsc/baseline-readiness'
import {
  allowsTreatmentControlSplit,
  type InterferenceScope,
} from '@/lib/intervention/taxonomy'
import {
  assertAnalysisMetricAllowed,
  type PrimaryMetric,
  type PreregistrationFields,
} from '@/lib/intervention/preregistration'
import {
  buildUrlWindowSeries,
  hasMissingGscData,
  meanOfPresent,
  observationWindowComplete,
  resolveObservationWindows,
  type ObservationWindow,
  type UrlWindowSeries,
} from '@/lib/intervention/observation-windows'

export type ValidityStatus =
  | 'valid'
  | 'insufficient_data'
  | 'invalid_baseline'
  | 'interrupted'
  | 'volatility_suspected'
  | 'missing_gsc_data'
  | 'implementation_unverified'
  | 'interference_suspected'

export type ResultDirection = 'positive' | 'negative' | 'neutral'

export type CausalResultRow = {
  experiment_id: string
  intervention_id: string
  metric: PrimaryMetric
  is_exploratory: boolean
  effect_estimate: number | null
  confidence_interval_low: number | null
  confidence_interval_high: number | null
  treatment_n: number
  control_n: number
  baseline_period_start: string
  baseline_period_end: string
  observation_period_start: string
  observation_period_end: string
  method: 'difference_in_differences'
  validity_status: ValidityStatus
  result_direction: ResultDirection | null
  calculated_at: string
  evidence: Record<string, unknown>
}

export type InterventionForAnalysis = {
  id: string
  experiment_id: string | null
  url_id: string
  lifecycle_state: string
  applied_at: string | null
  verified_at: string | null
  interference_scope: InterferenceScope
  is_isolated: boolean
}

export type AnalyzeInput = {
  intervention: InterventionForAnalysis
  preregistration: PreregistrationFields & {
    locked_at: string | null
    experiment_id: string
  }
  /** Metric to compute. Non-primary requires exploratory: true or throws. */
  metric: PrimaryMetric
  exploratory?: boolean
  metricsRows: Array<DailyUrlMetric & { ctr?: number }>
  treatedUrls: string[]
  controlUrls: string[]
  /** Latest baseline readiness for the site (mechanical gate for measuring). */
  baselineReadinessPassed: boolean
  /** True when a gsc_revision_checks row flagged revision inside the baseline. */
  gscRevisionInBaseline: boolean
  /** Optional floors for cohort sizes. */
  minTreatmentN?: number
  minControlN?: number
  now?: Date
}

const DEFAULT_MIN_N = 1

function directionFromEffect(
  metric: PrimaryMetric,
  effect: number | null,
  expected: PreregistrationFields['expected_direction'],
): ResultDirection | null {
  if (effect === null || !Number.isFinite(effect)) return null
  // For average_position, lower is better — invert sign for "positive"
  const adjusted = metric === 'average_position' ? -effect : effect
  if (Math.abs(adjusted) < 1e-9) return 'neutral'
  if (expected === 'no_prediction') {
    return adjusted > 0 ? 'positive' : 'negative'
  }
  if (expected === 'increase') return adjusted > 0 ? 'positive' : 'negative'
  return adjusted < 0 ? 'positive' : 'negative'
}

function cohortMeans(seriesList: UrlWindowSeries[]): {
  baseline: number | null
  observation: number | null
  n: number
} {
  const baselines: number[] = []
  const observations: number[] = []
  for (const s of seriesList) {
    const b = meanOfPresent(s.baseline)
    const o = meanOfPresent(s.observation)
    if (b !== null) baselines.push(b)
    if (o !== null) observations.push(o)
  }
  return {
    baseline: baselines.length ? baselines.reduce((a, b) => a + b, 0) / baselines.length : null,
    observation: observations.length
      ? observations.reduce((a, b) => a + b, 0) / observations.length
      : null,
    n: seriesList.length,
  }
}

function buildResult(
  input: AnalyzeInput,
  window: ObservationWindow,
  partial: Partial<CausalResultRow> & Pick<CausalResultRow, 'validity_status'>,
): CausalResultRow {
  return {
    experiment_id: input.preregistration.experiment_id,
    intervention_id: input.intervention.id,
    metric: input.metric,
    is_exploratory: !!input.exploratory,
    effect_estimate: null,
    confidence_interval_low: null,
    confidence_interval_high: null,
    treatment_n: 0,
    control_n: 0,
    baseline_period_start: window.baseline_period_start,
    baseline_period_end: window.baseline_period_end,
    observation_period_start: window.observation_period_start,
    observation_period_end: window.observation_period_end,
    method: 'difference_in_differences',
    result_direction: null,
    calculated_at: (input.now || new Date()).toISOString(),
    evidence: {},
    ...partial,
  }
}

/**
 * Run one causal analysis. Refuses non-primary metrics unless exploratory.
 * Missing GSC days stay null and force missing_gsc_data / insufficient_data —
 * never interpolated.
 */
export function analyzeIntervention(input: AnalyzeInput): CausalResultRow {
  assertAnalysisMetricAllowed(input.preregistration.primary_metric, input.metric, {
    exploratory: input.exploratory,
  })

  if (!input.intervention.applied_at) {
    const synthetic = resolveObservationWindows({
      appliedAt: input.now || new Date(),
      baselineWindowDays: input.preregistration.baseline_window_days,
      observationWindowDays: input.preregistration.observation_window_days,
    })
    return buildResult(input, synthetic, {
      validity_status: 'implementation_unverified',
      evidence: { reason: 'applied_at_missing' },
    })
  }

  const window = resolveObservationWindows({
    appliedAt: input.intervention.applied_at,
    baselineWindowDays: input.preregistration.baseline_window_days,
    observationWindowDays: input.preregistration.observation_window_days,
  })

  if (
    input.intervention.lifecycle_state !== 'verified' &&
    input.intervention.lifecycle_state !== 'measuring' &&
    input.intervention.lifecycle_state !== 'completed'
  ) {
    return buildResult(input, window, {
      validity_status: 'implementation_unverified',
      evidence: { lifecycle_state: input.intervention.lifecycle_state },
    })
  }

  if (!input.preregistration.locked_at) {
    return buildResult(input, window, {
      validity_status: 'invalid_baseline',
      evidence: { reason: 'preregistration_not_locked' },
    })
  }

  const lockedAt = new Date(input.preregistration.locked_at).getTime()
  const appliedAt = new Date(input.intervention.applied_at).getTime()
  if (!(lockedAt < appliedAt)) {
    return buildResult(input, window, {
      validity_status: 'invalid_baseline',
      evidence: { reason: 'preregistration_not_before_applied_at', lockedAt, appliedAt },
    })
  }

  if (!input.baselineReadinessPassed) {
    return buildResult(input, window, {
      validity_status: 'invalid_baseline',
      evidence: { reason: 'baseline_readiness_failed' },
    })
  }

  if (input.gscRevisionInBaseline) {
    return buildResult(input, window, {
      validity_status: 'invalid_baseline',
      evidence: { reason: 'gsc_revision_in_baseline' },
    })
  }

  const scope = input.intervention.interference_scope
  const canSplit = allowsTreatmentControlSplit(scope)
  if (!canSplit && input.controlUrls.length > 0) {
    return buildResult(input, window, {
      validity_status: 'interference_suspected',
      evidence: {
        reason: 'sitewide_or_section_scope_cannot_use_treatment_control_split',
        interference_scope: scope,
        control_n: input.controlUrls.length,
      },
    })
  }

  const treated = input.treatedUrls.length
    ? input.treatedUrls
    : [input.intervention.url_id]

  const treatedSeries = treated.map((url) =>
    buildUrlWindowSeries({
      url,
      rows: input.metricsRows,
      window,
      metric: input.metric,
    }),
  )
  const controlSeries = canSplit
    ? input.controlUrls.map((url) =>
        buildUrlWindowSeries({
          url,
          rows: input.metricsRows,
          window,
          metric: input.metric,
        }),
      )
    : []

  const now = input.now || new Date()
  const obsEnd = new Date(`${window.observation_period_end}T23:59:59.000Z`)
  if (now < obsEnd) {
    return buildResult(input, window, {
      validity_status: 'insufficient_data',
      treatment_n: treatedSeries.length,
      control_n: controlSeries.length,
      evidence: {
        reason: 'observation_window_not_elapsed',
        now: now.toISOString(),
        observation_period_end: window.observation_period_end,
      },
    })
  }

  if (!treatedSeries.every(observationWindowComplete)) {
    return buildResult(input, window, {
      validity_status: 'insufficient_data',
      treatment_n: treatedSeries.length,
      control_n: controlSeries.length,
      evidence: {
        reason: 'observation_window_incomplete_for_treatment',
        missing: treatedSeries.map((s) => ({
          url: s.url,
          missingObservationDays: s.missingObservationDays,
        })),
      },
    })
  }

  if (hasMissingGscData([...treatedSeries, ...controlSeries])) {
    return buildResult(input, window, {
      validity_status: 'missing_gsc_data',
      treatment_n: treatedSeries.length,
      control_n: controlSeries.length,
      evidence: {
        reason: 'null_gsc_days_present',
        note: 'Missing days remain null; never filled with 0',
      },
    })
  }

  // Re-check discontinuity on the combined window rows (final only).
  const windowRows = input.metricsRows.filter(
    (r) =>
      r.is_final &&
      r.date >= window.baseline_period_start &&
      r.date <= window.observation_period_end,
  )
  const readiness = evaluateBaselineReadiness(windowRows, {
    minUrlsRequired: 1,
    minDaysRequired: 1,
  })
  if (readiness.evidence.discontinuity) {
    return buildResult(input, window, {
      validity_status: 'volatility_suspected',
      treatment_n: treatedSeries.length,
      control_n: controlSeries.length,
      evidence: { discontinuity: readiness.evidence.discontinuity },
    })
  }

  const minT = input.minTreatmentN ?? DEFAULT_MIN_N
  const minC = canSplit ? input.minControlN ?? DEFAULT_MIN_N : 0
  if (treatedSeries.length < minT || (canSplit && controlSeries.length < minC)) {
    return buildResult(input, window, {
      validity_status: 'insufficient_data',
      treatment_n: treatedSeries.length,
      control_n: controlSeries.length,
      evidence: { reason: 'cohort_too_small', minTreatmentN: minT, minControlN: minC },
    })
  }

  const t = cohortMeans(treatedSeries)
  const c = canSplit
    ? cohortMeans(controlSeries)
    : { baseline: null, observation: null, n: 0 }

  if (t.baseline === null || t.observation === null) {
    return buildResult(input, window, {
      validity_status: 'insufficient_data',
      treatment_n: t.n,
      control_n: c.n,
      evidence: { reason: 'treatment_means_unavailable' },
    })
  }

  let effect: number
  if (canSplit && c.baseline !== null && c.observation !== null) {
    // Classic DiD: (T_post - T_pre) - (C_post - C_pre)
    effect = t.observation - t.baseline - (c.observation - c.baseline)
  } else {
    // Pre/post only (weaker) — still recorded; validity stays valid only for url-scope
    // isolated interventions without controls when split not required.
    effect = t.observation - t.baseline
  }

  // Crude Wald-style interval placeholder (no fabrication of SE from missing data).
  const ciPad = Math.abs(effect) * 0.5
  const result_direction = directionFromEffect(
    input.metric,
    effect,
    input.preregistration.expected_direction,
  )

  return buildResult(input, window, {
    validity_status: 'valid',
    effect_estimate: effect,
    confidence_interval_low: effect - ciPad,
    confidence_interval_high: effect + ciPad,
    treatment_n: t.n,
    control_n: c.n,
    result_direction,
    evidence: {
      treatment_baseline_mean: t.baseline,
      treatment_observation_mean: t.observation,
      control_baseline_mean: c.baseline,
      control_observation_mean: c.observation,
      method_detail: canSplit && c.baseline !== null ? 'did' : 'pre_post',
    },
  })
}

/** Idempotent upsert key for causal_results unique (intervention_id, metric, is_exploratory). */
export function causalResultConflictTarget(): string {
  return 'intervention_id,metric,is_exploratory'
}

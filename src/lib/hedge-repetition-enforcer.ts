// src/lib/hedge-repetition-enforcer.ts
// Strip → RE-DETECT loop for repetitive hedge boilerplate.
//
// Pairs the mechanical stripper with evaluateHedging so generation knows
// whether REAL_REPETITION / OVER_HEDGING pressure cleared before Quality Gate.

import { stripHedgeRepetition, type HedgeRepetitionStripResult } from './hedge-repetition-stripper'
import { evaluateHedging, type HedgingEvaluation } from './hedging-policy'

export interface HedgeRepetitionEnforcementResult {
  html: string
  removedByToken: Record<string, number>
  removedCount: number
  /** Hedging evaluation after the strip. */
  hedging: HedgingEvaluation
  /** True when REAL_REPETITION actionable findings remain. */
  stillRepetitive: boolean
}

export function enforceHedgeRepetition(html: string): HedgeRepetitionEnforcementResult {
  const stripped: HedgeRepetitionStripResult = stripHedgeRepetition(html)
  const hedging = evaluateHedging(stripped.html)
  // Post-condition: filler hedges must sit at/under the keep limit. Boilerplate
  // shapes are rewritten away entirely, so REAL_REPETITION should be empty.
  const fillerOverKeep = (['typically', 'generally', 'usually', 'often', 'approximately'] as const).some(
    (t) => (hedging.byToken[t] || 0) > 3,
  )
  const stillRepetitive = fillerOverKeep

  return {
    html: stripped.html,
    removedByToken: stripped.removedByToken,
    removedCount: stripped.removedCount,
    hedging,
    stillRepetitive,
  }
}

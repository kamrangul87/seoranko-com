// src/lib/dated-policy-enforcer.ts
// Strip → RE-DETECT loop for date-anchored policy claims.
//
// Pairs the mechanical stripper with the detectors that actually decide the
// Quality Gate's "dated-policy" category, so the pipeline knows whether the
// repair worked instead of assuming it. Anything the stripper cannot safely
// rewrite is returned (not hidden) and stays eligible for the freshness
// review path and the model-assisted sentence repair.

import { stripDateAnchors } from './date-anchor-stripper'
import {
  detectTimeAnchoredClaims,
  detectDatedClaims,
  type TimeAnchoredClaim,
  type DatedClaim,
} from './dated-claim-detector'

export interface DatedPolicyEnforcementResult {
  html: string
  appliedRules: string[]
  strippedCount: number
  /** Claims still anchored to a point in time after stripping. */
  remainingTimeAnchored: TimeAnchoredClaim[]
  remainingDatedClaims: DatedClaim[]
}

export function enforceDatedPolicy(html: string, now: Date = new Date()): DatedPolicyEnforcementResult {
  const stripped = stripDateAnchors(html)

  return {
    html: stripped.html,
    appliedRules: stripped.appliedRules,
    strippedCount: stripped.strippedCount,
    remainingTimeAnchored: detectTimeAnchoredClaims(stripped.html, now),
    remainingDatedClaims: detectDatedClaims(stripped.html, now),
  }
}

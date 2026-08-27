// src/lib/unsourced-numeric-enforcer.ts
// Strip → RE-DETECT loop for unsourced currency / percentage claims.
//
// Pairs the mechanical stripper with evaluateClaimEvidence so the pipeline
// knows whether the repair cleared claim-evidence / fact-sourcing floor
// pressure instead of assuming it. Anything still unsupported after the
// strip stays visible to Quality Gate (never hidden).

import {
  stripUnsourcedNumericClaims,
  remainingUnsourcedFigures,
  type UnsourcedNumericStripResult,
} from './unsourced-numeric-stripper'
import { stripAiSlopPhrases, type AiSlopStripResult } from './ai-slop-stripper'
import type { ClaimEvidence } from './claim-evidence'

export interface UnsourcedNumericEnforcementResult {
  html: string
  strippedFigures: string[]
  strippedCount: number
  strippedClaims: ClaimEvidence[]
  /** Claims still unsupported / partial after stripping. */
  remainingUnsourced: ClaimEvidence[]
  aiSlop: AiSlopStripResult
}

/**
 * Run unsourced-numeric generalization then AI-slop phrase removal.
 * AI-slop runs second so Readability never sees stock transitions that
 * the model left next to (now-generalized) claims.
 */
export function enforceUnsourcedNumericClaims(html: string): UnsourcedNumericEnforcementResult {
  const numeric: UnsourcedNumericStripResult = stripUnsourcedNumericClaims(html)
  const aiSlop = stripAiSlopPhrases(numeric.html)

  return {
    html: aiSlop.html,
    strippedFigures: numeric.strippedFigures,
    strippedCount: numeric.strippedCount,
    strippedClaims: numeric.strippedClaims,
    remainingUnsourced: remainingUnsourcedFigures(aiSlop.html),
    aiSlop,
  }
}

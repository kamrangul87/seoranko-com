/**
 * Topic 1 / 404-branch product decisions — not sourced thresholds.
 * Similarity floors and path-token weights are SEORANKO choices; no RFC or
 * Google doc publishes a successor-match figure.
 *
 * `floor` is sourced from FIX_STRATEGY_PRODUCT_DECISIONS.successorSimilarityFloor
 * so the register-wide product knob is authoritative.
 */

import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

export const SUCCESSOR_SIMILARITY_CONFIG: SuccessorSimilarityConfig = {
  /** Minimum combined score (0–1) to count as a successor candidate. */
  floor: FIX_STRATEGY_PRODUCT_DECISIONS.successorSimilarityFloor,
  /** Weight of path-segment similarity in the combined score. */
  pathWeight: 0.45,
  /** Weight of main-content similarity in the combined score. */
  contentWeight: 0.55,
}

export type SuccessorSimilarityConfig = {
  floor: number
  pathWeight: number
  contentWeight: number
}

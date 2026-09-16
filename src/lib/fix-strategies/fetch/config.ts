/**
 * Topic 68 product decisions — not sourced thresholds.
 * Values are read from FIX_STRATEGY_PRODUCT_DECISIONS so Stage 2 / topic 26
 * and the fetch layer share one product knob set.
 */
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '../product-decisions'

export const FETCH_EVIDENCE_CONFIG = {
  /** Delay when Retry-After is absent on 429/503 (ms). Product decision. */
  fallbackDelayMs: FIX_STRATEGY_PRODUCT_DECISIONS.refetchFallbackIntervalMs,
  /** Total HTTP attempts including the first. Product decision. */
  maxAttempts: FIX_STRATEGY_PRODUCT_DECISIONS.refetchMaxAttempts,
  /** Cap on honoured Retry-After / fallback wait (ms). Product decision. */
  maxRetryAfterMs: FIX_STRATEGY_PRODUCT_DECISIONS.refetchMaxHonouredRetryAfterMs,
  /** Per-request timeout (ms). Operational, not a register product decision. */
  timeoutMs: 10_000,
} as const

export type FetchEvidenceConfig = {
  fallbackDelayMs: number
  maxAttempts: number
  maxRetryAfterMs: number
  timeoutMs: number
}

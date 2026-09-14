/**
 * Topic 68 product decisions — not sourced thresholds.
 * RFC 9110 / 6585 leave fallback delay, attempt cap, and max honoured
 * Retry-After unspecified. These values are SEORANKO choices.
 */
export const FETCH_EVIDENCE_CONFIG = {
  /** Delay when Retry-After is absent on 429/503 (ms). */
  fallbackDelayMs: 1_000,
  /** Total HTTP attempts including the first (min 2 so a re-fetch can occur). */
  maxAttempts: 2,
  /** Cap on honoured Retry-After / fallback wait (ms). */
  maxRetryAfterMs: 60_000,
  /** Per-request timeout (ms). */
  timeoutMs: 10_000,
} as const

export type FetchEvidenceConfig = {
  fallbackDelayMs: number
  maxAttempts: number
  maxRetryAfterMs: number
  timeoutMs: number
}

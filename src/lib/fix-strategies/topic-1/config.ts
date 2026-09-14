/**
 * Topic 1 / 404-branch product decisions — not sourced thresholds.
 * Similarity floors and path-token weights are SEORANKO choices; no RFC or
 * Google doc publishes a successor-match figure.
 */
export const SUCCESSOR_SIMILARITY_CONFIG = {
  /** Minimum combined score (0–1) to count as a successor candidate. */
  floor: 0.55,
  /** Weight of path-segment similarity in the combined score. */
  pathWeight: 0.45,
  /** Weight of main-content similarity in the combined score. */
  contentWeight: 0.55,
} as const

export type SuccessorSimilarityConfig = typeof SUCCESSOR_SIMILARITY_CONFIG

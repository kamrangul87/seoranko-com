/**
 * Product decisions for the fix-strategies register.
 *
 * Every field here is a SEORANKO product choice, NOT a Google-sourced
 * threshold. Values left `null` are still unset. Setting a number here is a
 * product act — record the decision date in git history / PR, not by citing
 * a Google URL.
 *
 * Owning topics noted in comments. See docs/fix-strategies/_open-questions.md.
 */

export type UnsetProductDecision = null

/**
 * Collects product knobs called out by the register audit.
 */
export const FIX_STRATEGY_PRODUCT_DECISIONS = {
  /**
   * Topic 68 — re-fetch evidence.
   * Product decision, not a sourced threshold: RFC 9110 / 6585 leave fallback
   * delay, attempt cap, and max honoured Retry-After unspecified.
   *
   * Chosen 2026-09-16 for Stage 2 (topic 26):
   * - 1_000 ms fallback — short enough for CI/crawl throughput, long enough to
   *   clear brief overload without treating Retry-After as zero.
   * - 2 attempts — one confirming re-fetch (topic 68) without a retry storm.
   * - 60_000 ms max honoured Retry-After — caps crawl stalls on huge headers.
   * Aligns with existing FETCH_EVIDENCE_CONFIG operational defaults.
   */
  refetchFallbackIntervalMs: 1_000 as number,
  refetchMaxAttempts: 2 as number,
  refetchMaxHonouredRetryAfterMs: 60_000 as number,

  /**
   * Topic 3 — observation window before classifying `persistent-5xx`.
   * Distinct from topic 26's `stableAcrossRefetch` (5xx across one re-fetch
   * pair only). Still unset — see `_open-questions.md`.
   */
  persistent5xxObservationWindowMs: null as UnsetProductDecision,

  /**
   * Topics 1 / 41 — successor similarity floor for 301-vs-remove proposals.
   */
  successorSimilarityFloor: null as UnsetProductDecision,

  /**
   * Topic 45 — click-depth reporting threshold, if any.
   * Google publishes no numeric click-depth threshold (N10). Any number here
   * is reporting-only and must be labelled product decision in UI.
   */
  clickDepthReportingThreshold: null as UnsetProductDecision,

  /**
   * Topic 59 — impressions floor before raising "impressions, no internal links".
   */
  impressionsFloor: null as UnsetProductDecision,

  /**
   * Topics 55–59 — URL Inspection prioritisation under the 2,000/day cap.
   * Policy string or structured policy once chosen; unset until then.
   */
  urlInspectionPrioritisationPolicy: null as UnsetProductDecision,

  /**
   * Topic 49 — tolerance when comparing intrinsic image ratio to width/height
   * attributes (rounding at integer attributes is unavoidable).
   *
   * Product decision, not a sourced threshold. Chosen 2026-09-16: relative
   * |declaredRatio / intrinsicRatio - 1| ≤ 0.02 (2%). Tight enough to catch
   * 4:3-vs-16:9 mistakes; loose enough for ±1px rounding on large images.
   */
  imageIntrinsicRatioComparisonTolerance: 0.02 as number,
} as const

export type FixStrategyProductDecisions = typeof FIX_STRATEGY_PRODUCT_DECISIONS

/**
 * Product decisions for the fix-strategies register.
 *
 * Every field here is a SEORANKO product choice, NOT a Google-sourced
 * threshold. Values are deliberately unset (`null`) until product sets them.
 * Do not invent defaults that look like research findings.
 *
 * Owning topics noted in comments. See docs/fix-strategies/_open-questions.md.
 */

export type UnsetProductDecision = null

/**
 * Collects unset knobs called out by the register audit. Setting a number
 * here is a product act — record the decision date in git history / PR, not
 * by citing a Google URL.
 */
export const FIX_STRATEGY_PRODUCT_DECISIONS = {
  /**
   * Topic 68 — re-fetch evidence.
   * Fallback delay when Retry-After is absent; max HTTP attempts; max
   * honoured Retry-After. (Operational fetch defaults may live in
   * fetch/config.ts for topic-1 plumbing; those remain labelled product
   * decisions there too.)
   */
  refetchFallbackIntervalMs: null as UnsetProductDecision,
  refetchMaxAttempts: null as UnsetProductDecision,
  refetchMaxHonouredRetryAfterMs: null as UnsetProductDecision,

  /**
   * Topic 3 — observation window before classifying `persistent-5xx`.
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
   */
  imageIntrinsicRatioComparisonTolerance: null as UnsetProductDecision,
} as const

export type FixStrategyProductDecisions = typeof FIX_STRATEGY_PRODUCT_DECISIONS

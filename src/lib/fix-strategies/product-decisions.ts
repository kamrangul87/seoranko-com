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
   * pair only).
   *
   * Chosen 2026-09-17: 48 hours (172_800_000 ms).
   * Reasoning: Google's crawl-stats guidance warns against returning 503/429
   * for more than two or three days (context only — not our threshold). A
   * 48h window sits inside that band so a sustained outage is reportable as
   * `persistent-5xx`, while a single topic-68 re-fetch pair (~1s apart) cannot
   * mint the longer classification. Requires observations whose
   * `observedAtMs` span ≥ this window (scheduled crawls / stored evidence).
   */
  persistent5xxObservationWindowMs: 172_800_000 as number,

  /**
   * Topics 1 / 41 — successor similarity floor for 301-vs-remove proposals.
   * Combined path+content Jaccard must clear this floor to count as a
   * successor candidate. Exactly one candidate → proposed-301 (human-review);
   * two or more → ambiguous, no tie-break. Never auto-applies the 301.
   *
   * Chosen 2026-09-17: 0.55 — already documented in `_sources.md` row 57 and
   * previously hard-coded in topic-1/config.ts. Wiring it here makes the
   * product decision authoritative so the successor-proposal branch can run
   * without a silent local default.
   */
  successorSimilarityFloor: 0.55 as number,

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

  /**
   * Topics 30 / 31 — display-truncation character hint for titles/descriptions.
   * Product decision, NOT a Google-sourced threshold (H9 / H15 are explicit that
   * no fixed length limit is published). Left unset: a 200-character title must
   * produce NOTHING. If set later, UI must label it "product decision" and never
   * attribute it to Google or call it a defect / auto-fix.
   */
  titleDisplayTruncationHintChars: null as UnsetProductDecision,
  descriptionDisplayTruncationHintChars: null as UnsetProductDecision,

  /**
   * Topic 12a — known tracking / session parameter names that MAY be
   * duplicates when content is proven identical. Product decision for the
   * allow-list boundary (Google documents the class, not an exhaustive list).
   * Chosen 2026-09-16. Name alone is never sufficient — content must match.
   */
  trackingParameterAllowlist: [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_id',
    'gclid',
    'gbraid',
    'wbraid',
    'fbclid',
    'msclkid',
    'mc_eid',
    'mc_cid',
    'sessionid',
    'session_id',
    '_ga',
    '_gl',
  ] as readonly string[],

  /**
   * Findings crawl — per-user run quota (starts per UTC day).
   * Product decision (not Google-sourced). Chosen 2026-09-22 for launch
   * batch A: 20 crawl starts / user / day — enough for dogfood + iteration,
   * hard enough to stop accidental / abusive bulk starts on Hobby.
   *
   * @deprecated Prefer crawlRunsPerUserPerDayFree / Subscribed (1.6 billing).
   * Kept as the free-tier default so older callers stay safe.
   */
  crawlRunsPerUserPerDay: 5 as number,

  /**
   * Free / unsigned-subscription crawl starts per UTC day (detect-only stays free).
   * Chosen 2026-09-23 (1.6 billing): 5 — enough for a trial audit, stops bulk abuse.
   */
  crawlRunsPerUserPerDayFree: 5 as number,

  /**
   * Subscribed (or MASTER_EMAIL) crawl starts per UTC day.
   * Chosen 2026-09-23 (1.6 billing): 50 — dogfood + multi-site iteration on Hobby.
   */
  crawlRunsPerUserPerDaySubscribed: 50 as number,

  /**
   * Per-crawl page enqueue limit — free / no subscription.
   * Chosen 2026-09-24 (1.6 billing): 25. Hitting the cap → status partial with
   * an explicit plan-named note (never silent truncation).
   */
  crawlPagesPerRunFree: 25 as number,

  /**
   * Per-crawl page enqueue limit — paid default when Stripe Price/Product
   * metadata does not set `seoranko_crawl_pages` (or `crawl_pages_per_run`).
   * Chosen 2026-09-24 (1.6 billing): 500 (matches CRAWL_MAX_DISCOVERED safety).
   */
  crawlPagesPerRunPaidDefault: 500 as number,

  /**
   * Stripe metadata key (Price, then Product, then Subscription) for the
   * per-crawl page limit. Value must be a positive integer.
   */
  crawlPagesStripeMetadataKey: 'seoranko_crawl_pages' as string,

  /**
   * Findings crawl — minimum gap between HTTP requests to one target host.
   * Product decision. Chosen 2026-09-22: 500 ms (was 250 ms operational
   * constant). Aligns crawl politeness with a clearer product knob; the
   * crawl module reads this instead of a silent hard-code.
   */
  crawlPerHostMinGapMs: 500 as number,

  /**
   * Findings crawl — max concurrent in-flight requests per target host.
   * Product decision. Chosen 2026-09-22: 1 (strict serial per host) so
   * burst load never exceeds one outstanding fetch per customer origin.
   */
  crawlPerHostMaxConcurrent: 1 as number,
} as const

export type FixStrategyProductDecisions = typeof FIX_STRATEGY_PRODUCT_DECISIONS

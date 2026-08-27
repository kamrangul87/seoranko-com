/**
 * Shared freshness / time-sensitivity policy for dated-policy claims.
 *
 * Time status and evidence status are independent axes — never collapse
 * them into one boolean. Severity is derived only from this module so
 * detectDatedClaims, time-anchored claims, and DANGEROUS_FACT_PATTERNS
 * cannot disagree.
 *
 * Do NOT hard-code current grant amounts or policy figures here — those
 * belong in test fixtures / live source fetches only.
 */

import type { IssueSeverity } from './article-quality-gate'
import { isAdvisoryOpinionSentence } from './claim-factuality'

/** Temporal framing of the claim itself. */
export type FreshnessTimeStatus =
  | 'CURRENT'
  | 'HISTORICAL'
  | 'FUTURE'
  | 'OUTDATED'
  | 'NEEDS_REVIEW'

/** Whether evidence supports the claim (independent of time framing). */
export type FreshnessEvidenceStatus =
  | 'SUPPORTED'
  | 'PARTIALLY_SUPPORTED'
  | 'UNSUPPORTED'
  | 'CONTRADICTED'
  | 'NEEDS_REVIEW'

export type FreshnessClaimType =
  | 'grant'
  | 'regulation'
  | 'government-policy'
  | 'price'
  | 'statistic'
  | 'eligibility'
  | 'tax-legal'
  | 'technical-standard'
  | 'service-availability'
  | 'product'
  | 'deadline'
  | 'other-quantitative'
  | 'instructional'
  | 'non-factual'

export interface FreshnessFinding {
  sentence: string
  claimType: FreshnessClaimType
  timeStatus: FreshnessTimeStatus
  evidenceStatus: FreshnessEvidenceStatus
  /** Extracted figure when present (e.g. "£350", "75%") — never a hard-coded "correct" value. */
  figureText?: string
  /** Bound authoritative citation URL when one exists. */
  citationUrl?: string
  /** Optional live/fixture evidence summary for the UI. */
  evidenceSummary?: string
  recommendedAction: string
  /** Detector tag for debugging (chrono | time-anchored | dangerous-fact | evidence). */
  detector: string
}

/**
 * Map freshness axes → Quality Gate severity.
 *
 * critical — contradicted current gov/legal claim (material harm risk)
 * warning  — important claim needs verification / incomplete evidence
 * info     — historical/dated content properly sourced, or advisory only
 *
 * INFO must not reduce the Quality Gate score (recomputeQualityGateTotals
 * only penalises critical + warning).
 */
export function severityForFreshnessFinding(
  finding: Pick<FreshnessFinding, 'timeStatus' | 'evidenceStatus' | 'claimType'>,
): IssueSeverity | null {
  // Non-factual / instructional language → no issue
  if (finding.claimType === 'instructional' || finding.claimType === 'non-factual') {
    return null
  }

  if (finding.evidenceStatus === 'CONTRADICTED' || finding.timeStatus === 'OUTDATED') {
    return 'critical'
  }

  if (
    finding.evidenceStatus === 'SUPPORTED' &&
    (finding.timeStatus === 'HISTORICAL' || finding.timeStatus === 'FUTURE' || finding.timeStatus === 'CURRENT')
  ) {
    // Properly sourced — surface as info only for historical/future so the
    // panel can show evidence without tanking the score; skip CURRENT+SUPPORTED.
    if (finding.timeStatus === 'CURRENT') return null
    return 'info'
  }

  if (finding.evidenceStatus === 'UNSUPPORTED' || finding.evidenceStatus === 'NEEDS_REVIEW') {
    return 'warning'
  }

  if (finding.evidenceStatus === 'PARTIALLY_SUPPORTED') {
    return 'warning'
  }

  return 'warning'
}

/** Shared dated-policy warning severity for unsourced / needs-review claims. */
export const FRESHNESS_REVIEW_SEVERITY: IssueSeverity = 'warning'

/** Shared severity when a current claim is contradicted by authoritative evidence. */
export const FRESHNESS_CONTRADICTED_SEVERITY: IssueSeverity = 'critical'

/**
 * Relative-date language that is instructional/editorial only when it does
 * NOT co-occur with a quantitative/policy assertion.
 */
export const INSTRUCTIONAL_RELATIVE_RE =
  /\b(check|see|read|visit|review|confirm|verify|look up|refer to)\b.{0,40}\b(now|today|currently|the (?:latest|current) (?:rules?|guidance|page|site))\b/i

export const RELATIVE_TIME_RE =
  /\b(now|today|currently|this year|recently|at present|the current)\b/i

export const HISTORICAL_CLAIM_RE =
  /\b(before|prior to|until|up to|applications? before|previously|formerly|was|were|used to|introduced|launched|established|enacted|began|started)\b/i

export const FUTURE_CLAIM_RE =
  /\b(from|starting|beginning|after|will (?:rise|fall|increase|decrease|change|become)|due to (?:rise|fall|increase)|effective)\b/i

export const QUANTITATIVE_FACT_RE =
  /[£$€]\s?\d|\d+\s?%|\b(grant|scheme|fund(?:ing)?|subsid(?:y|ies)|rebate|allowance|rate|tariff|threshold|cap|eligib|tax|duty|levy|standard|regulation|policy)\b/i

export function isInstructionalNonFactual(sentence: string): boolean {
  if (INSTRUCTIONAL_RELATIVE_RE.test(sentence) && !/[£$€]\s?\d|\d+\s?%/.test(sentence)) {
    return true
  }
  // Bare "check the rules now" / "see guidance today" with no figure/policy noun
  if (
    /\b(check|see|read|visit)\b.{0,30}\b(now|today)\b/i.test(sentence) &&
    !QUANTITATIVE_FACT_RE.test(sentence)
  ) {
    return true
  }
  return false
}

export function classifyClaimType(sentence: string): FreshnessClaimType {
  if (isInstructionalNonFactual(sentence)) return 'instructional'
  if (isAdvisoryOpinionSentence(sentence)) return 'non-factual'
  if (!QUANTITATIVE_FACT_RE.test(sentence) && !RELATIVE_TIME_RE.test(sentence)) {
    return 'non-factual'
  }
  if (/\bgrant|rebate|subsid/i.test(sentence)) return 'grant'
  if (/\beligib/i.test(sentence)) return 'eligibility'
  if (/\b(tax|duty|levy|hmrc)\b/i.test(sentence)) return 'tax-legal'
  if (/\b(regulation|regulated|statutory|legislation)\b/i.test(sentence)) return 'regulation'
  if (/\b(policy|scheme|fund)\b/i.test(sentence)) return 'government-policy'
  if (/\b(price|cost|£|\$|€)\b/i.test(sentence)) return 'price'
  if (/\d+\s?%/.test(sentence) || /\b(statistic|average|rate)\b/i.test(sentence)) return 'statistic'
  if (/\b(standard|BS\s?\d|IEC)\b/i.test(sentence)) return 'technical-standard'
  if (/\b(available|availability|offer(?:ed|ing)?)\b/i.test(sentence)) return 'service-availability'
  if (/\b(deadline|by\s+(?:19|20)\d{2}|before\s+\d)/i.test(sentence)) return 'deadline'
  if (QUANTITATIVE_FACT_RE.test(sentence)) return 'other-quantitative'
  return 'non-factual'
}

export function classifyTimeStatus(sentence: string, now: Date = new Date()): FreshnessTimeStatus {
  const lower = sentence.toLowerCase()

  // Explicit historical framing with a past window / past figure
  if (
    /\b(applications?\s+before|prior to|formerly|previously|used to be)\b/i.test(lower) ||
    /\b(before|until)\b.{0,48}(?:\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)|(?:19|20)\d{2}|[£$€]\s?\d)/i.test(
      lower,
    ) ||
    /\b(was|were)\b.{0,40}[£$€%\d]/i.test(lower)
  ) {
    return 'HISTORICAL'
  }
  if (/\b(introduced|launched|established|enacted|began|started)\b/i.test(lower)) {
    // Establishment date in the past → historical fact, not a stale current claim
    return 'HISTORICAL'
  }

  // Future effective dates / "will change"
  if (
    /\bwill\s+(?:rise|fall|increase|decrease|change|become)\b/i.test(lower) ||
    /\b(from|starting|beginning|effective)\s+\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2}\b/i.test(lower) ||
    /\bfrom\s+1\s+april\s+20\d{2}\b/i.test(lower)
  ) {
    return 'FUTURE'
  }

  // Current framing
  if (
    /\b(currently|at present|the current|as of)\b/i.test(lower) ||
    /\b(now|today|this year)\b/i.test(lower)
  ) {
    return 'CURRENT'
  }

  // Bare dated "as of Month Year" without currently — still current-policy sensitive
  if (/\bas of\b/i.test(lower) || /\bfrom\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2}\b/i.test(lower)) {
    return 'CURRENT'
  }

  void now
  return 'NEEDS_REVIEW'
}

export function buildFreshnessRecommendedAction(
  finding: Pick<FreshnessFinding, 'timeStatus' | 'evidenceStatus' | 'citationUrl'>,
): string {
  if (finding.evidenceStatus === 'CONTRADICTED' || finding.timeStatus === 'OUTDATED') {
    return finding.citationUrl
      ? `Visit ${finding.citationUrl}, confirm the current figure, and update the sentence — or explicitly label the old figure as historical.`
      : 'Replace the outdated current claim with the figure from the official source, or rewrite it as a clearly historical statement.'
  }
  if (finding.timeStatus === 'HISTORICAL' && finding.evidenceStatus === 'SUPPORTED') {
    return 'No action required — historical claim is properly sourced.'
  }
  if (finding.evidenceStatus === 'UNSUPPORTED') {
    return finding.citationUrl
      ? `Confirm ${finding.citationUrl} actually states this figure, then keep the link next to the claim.`
      : 'Add a link to the official source that states this figure (prefer the relevant .gov page), then re-run Quality Gate.'
  }
  if (finding.timeStatus === 'FUTURE') {
    return 'Keep the future-effective framing clear; re-check closer to the effective date.'
  }
  if (finding.evidenceStatus === 'NEEDS_REVIEW' || finding.evidenceStatus === 'PARTIALLY_SUPPORTED') {
    return 'Verify the claim against the official source that actually states this figure — a citation elsewhere in the article is not enough if it does not support this claim.'
  }
  return 'Verify the claim against the official source and update the wording or citation if needed.'
}

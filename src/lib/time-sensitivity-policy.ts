/**
 * Phase 6 — authoritative time-sensitivity taxonomy.
 *
 * "Now" / "today" / "currently" alone are NOT factual errors.
 * Classify whether the sentence contains a time-sensitive factual claim.
 */

import {
  classifyClaimType,
  classifyTimeStatus,
  isInstructionalNonFactual,
  QUANTITATIVE_FACT_RE,
  RELATIVE_TIME_RE,
  type FreshnessClaimType,
  type FreshnessTimeStatus,
} from '@/lib/freshness-policy'
import { isAdvisoryOpinionSentence } from '@/lib/claim-factuality'

/** How time is expressed in the sentence. */
export type TimeExpressionKind =
  | 'explicit_date'
  | 'relative_date'
  | 'now'
  | 'today'
  | 'currently'
  | 'latest'
  | 'this_year'
  | 'none'

/** Domain of the (potential) claim. */
export type TimeSensitiveDomain =
  | 'government_policy'
  | 'grants'
  | 'pricing'
  | 'regulations'
  | 'statistics'
  | 'product_availability'
  | 'eligibility'
  | 'tax_legal'
  | 'technical_standard'
  | 'other_quantitative'
  | 'instructional'
  | 'non_factual'

export type TimeSensitivityVerdict =
  | 'INSTRUCTIONAL'
  | 'FACTUAL_TIME_SENSITIVE'
  | 'HISTORICAL_TRANSITION'
  | 'FUTURE_POLICY'
  | 'NOT_TIME_SENSITIVE'

export interface TimeSensitivityAssessment {
  sentence: string
  expressionKind: TimeExpressionKind
  domain: TimeSensitiveDomain
  timeStatus: FreshnessTimeStatus
  verdict: TimeSensitivityVerdict
  /** True only when Quality Gate should treat this as a factual freshness claim. */
  requiresVerification: boolean
  rationale: string
}

const EXPLICIT_DATE_RE =
  /\b(?:\d{1,2}\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2}\b|\b(?:19|20)\d{2}-\d{2}-\d{2}\b|\bas of\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2}\b/i

export function classifyTimeExpression(sentence: string): TimeExpressionKind {
  const s = sentence.toLowerCase()
  if (EXPLICIT_DATE_RE.test(s)) return 'explicit_date'
  if (/\bthis year\b/.test(s)) return 'this_year'
  if (/\blatest\b/.test(s)) return 'latest'
  if (/\bcurrently\b|\bat present\b|\bthe current\b/.test(s)) return 'currently'
  if (/\btoday\b/.test(s)) return 'today'
  if (/\bnow\b/.test(s)) return 'now'
  if (/\brecently\b|\blast (?:year|month|week)\b|\bearlier (?:this|in)\b/.test(s)) return 'relative_date'
  return 'none'
}

export function mapDomain(claimType: FreshnessClaimType): TimeSensitiveDomain {
  switch (claimType) {
    case 'grant':
      return 'grants'
    case 'government-policy':
      return 'government_policy'
    case 'regulation':
      return 'regulations'
    case 'price':
      return 'pricing'
    case 'statistic':
      return 'statistics'
    case 'service-availability':
    case 'product':
      return 'product_availability'
    case 'eligibility':
      return 'eligibility'
    case 'tax-legal':
      return 'tax_legal'
    case 'technical-standard':
      return 'technical_standard'
    case 'instructional':
      return 'instructional'
    case 'non-factual':
      return 'non_factual'
    default:
      return 'other_quantitative'
  }
}

/**
 * Single entry: does this sentence contain a time-sensitive factual claim?
 *
 * Examples:
 * - "Check the rules now." → INSTRUCTIONAL (no verification)
 * - "The grant is currently £500." → FACTUAL_TIME_SENSITIVE
 * - "From April 2026 the grant increased to £500." → HISTORICAL_TRANSITION / FUTURE
 */
export function assessTimeSensitivity(
  sentence: string,
  now: Date = new Date(),
): TimeSensitivityAssessment {
  const trimmed = sentence.trim()
  const expressionKind = classifyTimeExpression(trimmed)
  const claimType = classifyClaimType(trimmed)
  const domain = mapDomain(claimType)
  const timeStatus = classifyTimeStatus(trimmed, now)

  if (isInstructionalNonFactual(trimmed) || domain === 'instructional') {
    return {
      sentence: trimmed,
      expressionKind,
      domain: 'instructional',
      timeStatus,
      verdict: 'INSTRUCTIONAL',
      requiresVerification: false,
      rationale:
        'Relative time language is instructional/editorial only — not a factual dated-policy claim.',
    }
  }

  if (isAdvisoryOpinionSentence(trimmed)) {
    return {
      sentence: trimmed,
      expressionKind,
      domain: 'non_factual',
      timeStatus,
      verdict: 'NOT_TIME_SENSITIVE',
      requiresVerification: false,
      rationale:
        'Advisory/opinion phrasing without a verifiable figure or named rule — not a factual claim.',
    }
  }

  if (domain === 'non_factual' && !QUANTITATIVE_FACT_RE.test(trimmed)) {
    return {
      sentence: trimmed,
      expressionKind,
      domain,
      timeStatus,
      verdict: 'NOT_TIME_SENSITIVE',
      requiresVerification: false,
      rationale: 'No quantitative or policy assertion detected.',
    }
  }

  // Bare "now"/"today" without a material claim
  if (
    (expressionKind === 'now' || expressionKind === 'today' || expressionKind === 'latest') &&
    !QUANTITATIVE_FACT_RE.test(trimmed)
  ) {
    return {
      sentence: trimmed,
      expressionKind,
      domain,
      timeStatus,
      verdict: 'NOT_TIME_SENSITIVE',
      requiresVerification: false,
      rationale: `"${expressionKind}" alone is not a factual error without a time-sensitive assertion.`,
    }
  }

  if (timeStatus === 'HISTORICAL') {
    return {
      sentence: trimmed,
      expressionKind,
      domain,
      timeStatus,
      verdict: 'HISTORICAL_TRANSITION',
      requiresVerification: true,
      rationale: 'Historical / transition claim — verify against the dated source, not as a stale "current" figure.',
    }
  }

  if (timeStatus === 'FUTURE') {
    return {
      sentence: trimmed,
      expressionKind,
      domain,
      timeStatus,
      verdict: 'FUTURE_POLICY',
      requiresVerification: true,
      rationale: 'Future-effective policy statement — verify framing; not automatically outdated.',
    }
  }

  const hasRelativeOrDate =
    expressionKind !== 'none' || RELATIVE_TIME_RE.test(trimmed) || EXPLICIT_DATE_RE.test(trimmed)

  if (hasRelativeOrDate && QUANTITATIVE_FACT_RE.test(trimmed)) {
    return {
      sentence: trimmed,
      expressionKind,
      domain,
      timeStatus: timeStatus === 'NEEDS_REVIEW' ? 'CURRENT' : timeStatus,
      verdict: 'FACTUAL_TIME_SENSITIVE',
      requiresVerification: true,
      rationale: 'Time-sensitive factual claim (policy/figure/rate) requiring current verification.',
    }
  }

  if (QUANTITATIVE_FACT_RE.test(trimmed) && (domain === 'grants' || domain === 'pricing' || domain === 'statistics' || domain === 'government_policy' || domain === 'regulations')) {
    return {
      sentence: trimmed,
      expressionKind,
      domain,
      timeStatus: 'NEEDS_REVIEW',
      verdict: 'FACTUAL_TIME_SENSITIVE',
      requiresVerification: true,
      rationale: 'Material policy/financial/statistic claim without clear time framing — still verify.',
    }
  }

  return {
    sentence: trimmed,
    expressionKind,
    domain,
    timeStatus,
    verdict: 'NOT_TIME_SENSITIVE',
    requiresVerification: false,
    rationale: 'No time-sensitive factual claim detected.',
  }
}

export function isFactualTimeSensitiveClaim(sentence: string, now?: Date): boolean {
  return assessTimeSensitivity(sentence, now).requiresVerification
}

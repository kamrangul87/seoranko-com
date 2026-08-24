/**
 * Authoritative Quality Gate decision policy (Phase 5 consistency).
 *
 * evidenceStatus and freshnessStatus are separate axes.
 * Severity / title / dimension / blocking are derived HERE — callers must not
 * invent a second contradictory mapping for the same claim state.
 *
 * Score contribution remains centralised in buildExplainableScore /
 * scoreFromIssues (critical −20, warning −5, info 0).
 *
 * ## Dimension status (via buildExplainableScore)
 * PASS     — no issues in the dimension
 * ADVISORY — only info severity
 * REVIEW   — at least one warning (no critical)
 * FAIL     — at least one critical
 *
 * Claim issues keep category grant-figure / claim-evidence. Freshness ownership
 * for currency claims is expressed via affectsDimensions (never by remapping
 * into dated-policy, which has its own detector + severity unify).
 *
 * ## Matrix (material grant / financial figures)
 * SUPPORTED + CURRENT          → no issue (PASS)
 * SUPPORTED + unknown currency → info / Freshness ADVISORY
 * HISTORICAL + supported       → info
 * PARTIALLY_SUPPORTED          → warning; Factual + Freshness REVIEW
 * UNSUPPORTED material         → critical / blocking
 * CONTRADICTED / OUTDATED      → critical / blocking
 */

import type { ClaimEvidenceStatus, ClaimEvidenceKind } from '@/lib/claim-evidence'
import type { FreshnessTimeStatus } from '@/lib/freshness-policy'
import type { IssueSeverity } from '@/lib/article-quality-gate'

export type DecisionDimensionId =
  | 'factual_verification'
  | 'freshness'
  | 'technical_seo'
  | 'structured_data'
  | 'readability'
  | 'internal_linking'
  | 'editorial'

export type FixStatus =
  | 'AUTO_FIX_ATTEMPTED'
  | 'AUTO_FIX_FAILED'
  | 'AUTO_FIX_CONFIRMED'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'NO_FIX_NEEDED'

export type ClaimDecisionInput = {
  evidenceStatus: ClaimEvidenceStatus
  /** When unknown, use NEEDS_REVIEW — never invent CURRENT without evidence. */
  freshnessStatus: FreshnessTimeStatus | 'UNKNOWN'
  /** Material grant / regulatory / financial figure. */
  material: boolean
  figureText?: string
  /** When set, PARTIAL titles distinguish time-sensitive policy vs survey/price stats. */
  claimKind?: ClaimEvidenceKind
  /** Live auto-verify confirmed the figure on the source page. */
  liveCurrentConfirmed?: boolean
}

export type ClaimDecision = {
  /** null = do not emit a Quality Gate issue (PASS for this claim). */
  severity: IssueSeverity | null
  blocking: boolean
  /** Primary dimension owner. */
  dimension: DecisionDimensionId
  /** Additional dimensions that must reflect this issue (no silent PASS). */
  alsoAffects: DecisionDimensionId[]
  title: string
  explanation: string
  evidenceStatus: ClaimEvidenceStatus
  freshnessStatus: FreshnessTimeStatus | 'UNKNOWN'
  fixStatus: FixStatus
}

function figureLabel(figureText?: string): string {
  return figureText ? `: "${figureText}"` : ''
}

/**
 * Single mapping: evidence × freshness → severity, title, dimensions, blocking.
 */
export function decideClaimIssue(input: ClaimDecisionInput): ClaimDecision {
  const { evidenceStatus, material, figureText, liveCurrentConfirmed, claimKind } = input
  let freshnessStatus = input.freshnessStatus

  // Live confirmation upgrades unknown currency to CURRENT for decisioning.
  if (liveCurrentConfirmed && (freshnessStatus === 'UNKNOWN' || freshnessStatus === 'NEEDS_REVIEW')) {
    freshnessStatus = 'CURRENT'
  }

  // CONTRADICTED — material → critical block
  if (evidenceStatus === 'CONTRADICTED') {
    return {
      severity: 'critical',
      blocking: true,
      dimension: 'factual_verification',
      alsoAffects: ['freshness'],
      title: `Current claim conflicts with authoritative source${figureLabel(figureText)}`,
      explanation:
        'Authoritative evidence contradicts this claim. Update the figure or rewrite it as historical before publishing.',
      evidenceStatus,
      freshnessStatus: freshnessStatus === 'UNKNOWN' ? 'OUTDATED' : freshnessStatus,
      fixStatus: 'MANUAL_REVIEW_REQUIRED',
    }
  }

  // OUTDATED evidence or time
  if (evidenceStatus === 'OUTDATED' || freshnessStatus === 'OUTDATED') {
    return {
      severity: 'critical',
      blocking: true,
      dimension: 'freshness',
      alsoAffects: ['factual_verification'],
      title: `Current claim appears outdated${figureLabel(figureText)}`,
      explanation:
        'This claim is framed as current but conflicts with newer authoritative values. Update or mark as historical.',
      evidenceStatus: evidenceStatus === 'OUTDATED' ? 'OUTDATED' : evidenceStatus,
      freshnessStatus: 'OUTDATED',
      fixStatus: 'MANUAL_REVIEW_REQUIRED',
    }
  }

  // HISTORICAL + supported → info / PASS-like (no score drag)
  if (evidenceStatus === 'HISTORICAL' || freshnessStatus === 'HISTORICAL') {
    if (evidenceStatus === 'SUPPORTED' || evidenceStatus === 'HISTORICAL' || evidenceStatus === 'PARTIALLY_SUPPORTED') {
      return {
        severity: 'info',
        blocking: false,
        dimension: 'freshness',
        alsoAffects: [],
        title: `Historical claim verified${figureLabel(figureText)}`,
        explanation: 'This claim is framed as historical and has supporting evidence. No publish block.',
        evidenceStatus: evidenceStatus === 'HISTORICAL' ? 'HISTORICAL' : evidenceStatus,
        freshnessStatus: 'HISTORICAL',
        fixStatus: 'NO_FIX_NEEDED',
      }
    }
  }

  // SUPPORTED + CURRENT (or live-confirmed) → PASS (no issue)
  if (evidenceStatus === 'SUPPORTED' && (freshnessStatus === 'CURRENT' || liveCurrentConfirmed)) {
    return {
      severity: null,
      blocking: false,
      dimension: 'factual_verification',
      alsoAffects: [],
      title: `Claim supported and current${figureLabel(figureText)}`,
      explanation: 'Bound source supports this figure; currentness confirmed or accepted.',
      evidenceStatus,
      freshnessStatus: 'CURRENT',
      fixStatus: 'NO_FIX_NEEDED',
    }
  }

  // SUPPORTED + currency unknown → advisory only (does not reduce score, does not FAIL)
  if (evidenceStatus === 'SUPPORTED') {
    return {
      severity: 'info',
      blocking: false,
      dimension: 'freshness',
      alsoAffects: [],
      title: `Currentness verification recommended${figureLabel(figureText)}`,
      explanation:
        'The claim is supported by a bound source in the article. Live currentness was not re-checked — optional review only; not a factual failure.',
      evidenceStatus,
      freshnessStatus: freshnessStatus === 'UNKNOWN' ? 'NEEDS_REVIEW' : freshnessStatus,
      fixStatus: 'NO_FIX_NEEDED',
    }
  }

  // PARTIALLY_SUPPORTED — official/topical but figure not confirmed in context
  if (evidenceStatus === 'PARTIALLY_SUPPORTED') {
    const timeSensitive =
      material ||
      claimKind === 'grant' ||
      claimKind === 'government-policy' ||
      claimKind === 'eligibility' ||
      claimKind === 'regulation' ||
      claimKind === 'tax-legal'
    if (timeSensitive) {
      return {
        severity: 'warning',
        blocking: false,
        dimension: 'factual_verification',
        alsoAffects: ['freshness'],
        title: `Currentness verification required${figureLabel(figureText)}`,
        explanation:
          'A related official source is bound, but the figure was not confirmed in that source’s article context. Confirm the page states this value before treating the claim as fully supported.',
        evidenceStatus,
        freshnessStatus: freshnessStatus === 'UNKNOWN' ? 'NEEDS_REVIEW' : freshnessStatus,
        fixStatus: 'MANUAL_REVIEW_REQUIRED',
      }
    }
    return {
      severity: 'warning',
      blocking: false,
      dimension: 'factual_verification',
      alsoAffects: [],
      title: `Figure not confirmed in cited context${figureLabel(figureText)}`,
      explanation:
        'A related source is bound, but this figure was not confirmed in that source’s article context. This is not a currentness/grant check — confirm the statistic or price against the cited page, or add a source that states this value.',
      evidenceStatus,
      freshnessStatus: freshnessStatus === 'UNKNOWN' ? 'NEEDS_REVIEW' : freshnessStatus,
      fixStatus: 'MANUAL_REVIEW_REQUIRED',
    }
  }

  // NEEDS_REVIEW
  if (evidenceStatus === 'NEEDS_REVIEW') {
    return {
      severity: 'warning',
      blocking: false,
      dimension: 'factual_verification',
      alsoAffects: ['freshness'],
      title: `Claim needs verification${figureLabel(figureText)}`,
      explanation: 'This claim needs human verification against an authoritative source.',
      evidenceStatus,
      freshnessStatus: freshnessStatus === 'UNKNOWN' ? 'NEEDS_REVIEW' : freshnessStatus,
      fixStatus: 'MANUAL_REVIEW_REQUIRED',
    }
  }

  // UNSUPPORTED — material financial/grant → critical; else warning
  if (evidenceStatus === 'UNSUPPORTED') {
    if (material) {
      return {
        severity: 'critical',
        blocking: true,
        dimension: 'factual_verification',
        alsoAffects: [],
        title: `Unsupported material figure — verify before publishing${figureLabel(figureText)}`,
        explanation:
          'No citation in this article supports this material financial/policy figure. Add an official source that states this value, or remove the figure.',
        evidenceStatus,
        freshnessStatus: freshnessStatus === 'UNKNOWN' ? 'NEEDS_REVIEW' : freshnessStatus,
        fixStatus: 'MANUAL_REVIEW_REQUIRED',
      }
    }
    return {
      severity: 'warning',
      blocking: false,
      dimension: 'factual_verification',
      alsoAffects: [],
      title: `Important claim lacks supporting evidence${figureLabel(figureText)}`,
      explanation: 'Add an official source link that supports this specific claim.',
      evidenceStatus,
      freshnessStatus,
      fixStatus: 'MANUAL_REVIEW_REQUIRED',
    }
  }

  // FUTURE
  if (freshnessStatus === 'FUTURE') {
    return {
      severity: 'info',
      blocking: false,
      dimension: 'freshness',
      alsoAffects: [],
      title: `Future-dated policy statement${figureLabel(figureText)}`,
      explanation: 'Future-dated claim — verify closer to the effective date.',
      evidenceStatus,
      freshnessStatus: 'FUTURE',
      fixStatus: 'NO_FIX_NEEDED',
    }
  }

  // Fallback — never invent critical
  return {
    severity: 'warning',
    blocking: false,
    dimension: 'factual_verification',
    alsoAffects: [],
    title: `Claim requires review${figureLabel(figureText)}`,
    explanation: 'Review this claim against authoritative sources.',
    evidenceStatus,
    freshnessStatus,
    fixStatus: 'MANUAL_REVIEW_REQUIRED',
  }
}

/** Default freshness axis when only claim-evidence status is known (no live research). */
export function defaultFreshnessForEvidence(
  evidenceStatus: ClaimEvidenceStatus,
): FreshnessTimeStatus | 'UNKNOWN' {
  if (evidenceStatus === 'HISTORICAL') return 'HISTORICAL'
  if (evidenceStatus === 'OUTDATED' || evidenceStatus === 'CONTRADICTED') return 'OUTDATED'
  if (evidenceStatus === 'SUPPORTED') return 'UNKNOWN' // article-local support ≠ live CURRENT
  if (evidenceStatus === 'PARTIALLY_SUPPORTED' || evidenceStatus === 'NEEDS_REVIEW') {
    return 'NEEDS_REVIEW'
  }
  return 'UNKNOWN'
}

export function formatFixAllScoreSummary(opts: {
  confirmedFixCount: number
  scoreBefore: number
  scoreAfter: number
  stillNeedsManualReview: number
  revalidationFoundAdditionalIssues?: boolean
  confirmationSummary?: string
}): string {
  const before = Math.round(opts.scoreBefore)
  const after = Math.round(opts.scoreAfter)
  // Use an em-dash / middle-dot separator so "70 → 70. 3 still need…" cannot
  // be misread as a decimal score "70.3".
  const scorePart = `Score ${before} → ${after}`

  if (opts.revalidationFoundAdditionalIssues) {
    return (
      opts.confirmationSummary ||
      `Auto-fix changed the article and revalidation found additional issues. ${scorePart}.`
    )
  }
  if (opts.stillNeedsManualReview === 0) {
    if (opts.confirmedFixCount === 0) {
      return `No fixes confirmed after revalidation. ${scorePart}.`
    }
    return `Confirmed ${opts.confirmedFixCount} fix(es) after revalidation. ${scorePart}. Ready for a final human skim.`
  }
  if (opts.confirmedFixCount === 0) {
    return `Confirmed 0 fix(es). ${scorePart} · ${opts.stillNeedsManualReview} still need manual review.`
  }
  return `Confirmed ${opts.confirmedFixCount} fix(es). ${scorePart} · ${opts.stillNeedsManualReview} still need manual review.`
}

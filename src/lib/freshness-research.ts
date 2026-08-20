/**
 * Phase 13 — current-freshness research architecture.
 *
 * Workflow when a claim may have changed materially:
 *   detect → classify → (optional) search authoritative source →
 *   record source date → compare → mark status →
 *   preserve source URL + verification timestamp
 *
 * NEVER treat the article's own "Last updated" / dateline as evidence.
 */

import { assessTimeSensitivity } from '@/lib/time-sensitivity-policy'
import { classifyClaimType } from '@/lib/freshness-policy'
import type { FreshnessAuthoritativeEvidence } from '@/lib/freshness-evaluator'

export type FreshnessResearchStatus =
  | 'CURRENT'
  | 'HISTORICAL'
  | 'OUTDATED'
  | 'UNCERTAIN'

export type FreshnessResearchClaim = {
  sentence: string
  figureText?: string
  claimType: string
  /** ISO timestamp when this verification ran. */
  verifiedAt: string
  status: FreshnessResearchStatus
  sourceUrl?: string
  /** Date from the *authoritative source*, never from the article dateline. */
  sourceDate?: string
  detail: string
}

export type FreshnessResearchResult = {
  claim: FreshnessResearchClaim
  /** Evidence record suitable for evaluateFreshness / applyAuthoritativeEvidence. */
  evidence: FreshnessAuthoritativeEvidence | null
}

/** Strip article-owned freshness chrome so it cannot be mistaken for evidence. */
export function stripArticleDatelineEvidence(html: string): string {
  return html
    .replace(/<p[^>]*class=["'][^"']*dateline[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
    .replace(/\bLast updated:\s*[^.<]{0,40}/gi, '')
    .replace(/\bFact-checked:\s*[^.<]{0,40}/gi, '')
}

/**
 * True when this sentence should enter the research workflow.
 * Instructional / non-factual "now" language is excluded.
 */
export function shouldResearchClaim(sentence: string, now: Date = new Date()): boolean {
  const trimmed = sentence.trim()
  if (!trimmed) return false
  const claimType = classifyClaimType(trimmed)
  if (claimType === 'instructional' || claimType === 'non-factual') return false
  const sensitivity = assessTimeSensitivity(trimmed, now)
  return sensitivity.requiresVerification
}

/**
 * Compare a claim figure against authoritative evidence amounts.
 * Does not use article datelines.
 */
export function compareClaimToEvidence(opts: {
  sentence: string
  figureText?: string
  evidence: FreshnessAuthoritativeEvidence | null
  isHistoricalClaim?: boolean
}): FreshnessResearchStatus {
  const { sentence, figureText, evidence, isHistoricalClaim } = opts
  if (isHistoricalClaim) return 'HISTORICAL'
  if (!evidence) return 'UNCERTAIN'

  const claimAmounts = extractAmounts(figureText || sentence)
  const evidenceAmounts = (evidence.amounts || []).concat(
    evidence.currentValueText ? extractAmounts(evidence.currentValueText) : [],
  )

  if (claimAmounts.length === 0) {
    if (evidence.supportsCurrent) return 'CURRENT'
    return 'UNCERTAIN'
  }
  if (evidenceAmounts.length === 0) return 'UNCERTAIN'

  const norm = (a: string) => a.replace(/\s+/g, '').toLowerCase()
  const evSet = new Set(evidenceAmounts.map(norm))
  const allMatch = claimAmounts.every((a) => evSet.has(norm(a)))
  const anyConflict = claimAmounts.some((a) => !evSet.has(norm(a)))

  if (allMatch && evidence.supportsCurrent !== false) return 'CURRENT'
  if (anyConflict && evidence.supportsCurrent) return 'OUTDATED'
  if (evidence.supportsHistorical && !evidence.supportsCurrent) return 'HISTORICAL'
  return 'UNCERTAIN'
}

function extractAmounts(text: string): string[] {
  const re =
    /£\s*[\d,]+(?:\.\d+)?|\$\s*[\d,]+(?:\.\d+)?|€\s*[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?%/g
  return Array.from(text.matchAll(re)).map((m) => m[0].replace(/\s+/g, ''))
}

export type FreshnessResearchProvider = (input: {
  sentence: string
  figureText?: string
}) => Promise<FreshnessAuthoritativeEvidence | null> | FreshnessAuthoritativeEvidence | null

/**
 * Run the Phase 13 workflow for one sentence.
 * When `provider` is absent/unavailable → UNCERTAIN (never silent PASS).
 */
export async function researchClaimFreshness(input: {
  sentence: string
  figureText?: string
  now?: Date
  isHistoricalClaim?: boolean
  /** Optional web/fixture research — production may omit when keys unavailable. */
  provider?: FreshnessResearchProvider
}): Promise<FreshnessResearchResult> {
  const now = input.now ?? new Date()
  const verifiedAt = now.toISOString()
  const claimType = classifyClaimType(input.sentence)

  if (!shouldResearchClaim(input.sentence, now) && !input.isHistoricalClaim) {
    return {
      claim: {
        sentence: input.sentence,
        figureText: input.figureText,
        claimType,
        verifiedAt,
        status: 'CURRENT',
        detail: 'Not time-sensitive / instructional — research skipped.',
      },
      evidence: null,
    }
  }

  let evidence: FreshnessAuthoritativeEvidence | null = null
  if (input.provider) {
    try {
      evidence = (await input.provider({
        sentence: input.sentence,
        figureText: input.figureText,
      })) ?? null
    } catch {
      evidence = null
    }
  }

  const status = compareClaimToEvidence({
    sentence: input.sentence,
    figureText: input.figureText,
    evidence,
    isHistoricalClaim: input.isHistoricalClaim,
  })

  const claim: FreshnessResearchClaim = {
    sentence: input.sentence,
    figureText: input.figureText,
    claimType,
    verifiedAt,
    status,
    sourceUrl: evidence?.sourceUrl,
    sourceDate: evidence?.sourceUpdatedAt,
    detail:
      status === 'UNCERTAIN' && !evidence
        ? 'No authoritative research available — mark for review.'
        : status === 'OUTDATED'
          ? `Claim conflicts with authoritative source${evidence?.currentValueText ? ` (current: ${evidence.currentValueText})` : ''}.`
          : status === 'HISTORICAL'
            ? 'Claim framed as historical — preserve as past tense / archive context.'
            : status === 'CURRENT'
              ? 'Claim matches authoritative source.'
              : 'Insufficient evidence to confirm.',
  }

  return { claim, evidence }
}

/**
 * Build an evidenceProvider for evaluateFreshness from a research provider.
 * Article datelines are never consulted.
 */
export function evidenceProviderFromResearch(
  provider: FreshnessResearchProvider,
): (
  finding: { sentence: string; figureText?: string },
) => Promise<FreshnessAuthoritativeEvidence | null> {
  return async (finding) => {
    const result = await researchClaimFreshness({
      sentence: finding.sentence,
      figureText: finding.figureText,
      provider,
    })
    return result.evidence
  }
}

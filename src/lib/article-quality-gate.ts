// src/lib/article-quality-gate.ts
// Pre-publish quality gate — runs after generation AND after humanization
// Inspired by: seomachine content_scorer.py, anti-slop 507-entry banned list,
// Agentic SEO Skill validation agents, Alpha Level SEO copywriting checklist 2026
//
// Gap filled: every existing tool audits AFTER publish. This gate runs BEFORE save.

// ============================================================
// RULE DEFINITIONS
// ============================================================

import { validateSchema } from './schema-validator'
import { verifyLogoUrlReachable } from './logo-reachability'
import { validateArticleStructure } from './structure-validator'
import { createClient } from '@supabase/supabase-js'
import { lintProse } from './prose-linter'
import { checkTopicAlignment } from '@/lib/topic-alignment'
import { countArticleWords } from '@/lib/word-count'
import { parseFAQsFromArticle } from '@/lib/faq-generator'
import {
  applyGuardedRegexReplace,
  scrubInsertionCorruption,
} from '@/lib/sentence-integrity'
import { assertImageUrlsPreserved, transformHtmlTextNodes } from '@/lib/html-text-transform'
import {
  DATED_POLICY_SEVERITY,
} from '@/lib/quality-gate-policy'
import {
  detectStaleYearReferences,
  extractHeadingTexts,
  detectTimeAnchoredClaims,
  type TimeAnchoredClaim,
} from '@/lib/dated-claim-detector'
import {
  verifyFigureAgainstCitation,
  sourceLabelForUrl,
  type CitationVerifyStatus,
} from '@/lib/citation-auto-verify'
import { withActionHints } from '@/lib/quality-issue-action-hints'
import {
  FRESHNESS_REVIEW_SEVERITY,
  severityForFreshnessFinding,
  type FreshnessFinding,
} from '@/lib/freshness-policy'
import {
  buildFreshnessIssueDescription,
  evaluateFreshness,
  evaluateFreshnessSync,
  freshnessFindingsRequiringIssues,
  freshnessIssueTitle,
} from '@/lib/freshness-evaluator'
import {
  evidenceProviderFromResearch,
  type FreshnessResearchProvider,
} from '@/lib/freshness-research'
import {
  evaluateClaimEvidence,
  formatClaimEvidenceDescription,
  isGrantFigureOwnedClaim,
  normalizeClaimFigureIdentity,
  type ClaimEvidence,
  type ClaimEvidenceStatus,
} from '@/lib/claim-evidence'
import {
  decideClaimIssue,
  defaultFreshnessForEvidence,
} from '@/lib/quality-decision-policy'
import { evaluateHedging, isExtremeHedgeDensity } from '@/lib/hedging-policy'
import { assessEditorialWordCount } from '@/lib/editorial-word-count'
import {
  confirmAutoFixOutcomes,
  scoreFromIssues,
  type AutoFixConfirmation,
} from '@/lib/autofix-confirmation'
import {
  buildExplainableScore,
  type ExplainableScoreResult,
} from '@/lib/quality-score-dimensions'
import { keywordPresenceHeuristic } from '@/lib/google-seo-policy'

// AI slop patterns — expanded from anti-slop GitHub repo
const AI_SLOP_PATTERNS = [
  /\bin today's (world|landscape|digital age|fast-paced)/i,
  /\bit('s| is) (worth noting|important to note|crucial to understand)/i,
  /\bin (conclusion|summary|this article|this guide|this piece)/i,
  /\bwe will (explore|delve into|dive into|examine|discuss)/i,
  /\blet('s| us) (explore|delve into|dive into|examine)/i,
  /\bcomprehensive (guide|overview|look|analysis)/i,
  /\bin the realm of/i,
  /\bleverage (your|our|the|this)/i,
  /\bdelve into/i,
  /\bfurthermore,/i,
  /\bmoreover,/i,
  /\bthe bottom line is/i,
  /\bit goes without saying/i,
  /\bneedless to say/i,
  /\bwithout further ado/i,
  /\bat the end of the day/i,
  /\bin other words,/i,
  /\bto summarize,/i,
  /\bto conclude,/i,
]

// Dated-policy / freshness detection is owned exclusively by
// evaluateFreshnessSync → buildDatedPolicyIssues (shared severity via
// freshness-policy). Do not re-introduce a parallel DANGEROUS_FACT_PATTERNS
// loop — it previously duplicated chrono findings at a divergent severity.

// ============================================================
// CLAIM-CITATION BINDING (grant-figure claims)
// ============================================================
// Coarse proximity-window citation checking is the wrong technique — it
// misses citations placed earlier in the article and depends on exact
// wording near the claim. The correct approach (per RARR, Gao et al. ACL
// 2023, and "Ground Every Sentence", NAACL 2025) is document-level
// claim-to-citation binding: does ANY citation anywhere in the article
// topically support this specific claim, not "is there a citation within
// N characters."

interface Citation {
  url: string
  anchorText: string
  position: number
  topicTerms: Set<string>   // extracted entities/topic words near this citation
}

interface Claim {
  text: string
  position: number
  topicTerms: Set<string>   // entities/topic words in and around the claim
}

// Extract meaningful topic words (strip stopwords) for entity-level matching
function extractTopicTerms(text: string): Set<string> {
  const stopwords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'been', 'will'])
  return new Set(
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopwords.has(w))
  )
}

// Find every citation link in the document with its surrounding topic context
function extractCitations(articleContent: string): Citation[] {
  const citations: Citation[] = []
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi
  let match

  while ((match = linkRegex.exec(articleContent)) !== null) {
    const url = match[1]
    // Only count authoritative citation sources — gov.uk, legislation.gov.uk, ofgem, official regulators
    const isAuthoritative = /\.(gov\.uk|legislation\.gov\.uk|ofgem\.gov\.uk)/i.test(url)
    if (!isAuthoritative) continue

    const contextStart = Math.max(0, match.index - 400)
    const contextEnd = Math.min(articleContent.length, match.index + 400)
    const surroundingContext = articleContent.slice(contextStart, contextEnd)

    citations.push({
      url,
      anchorText: match[2],
      position: match.index,
      topicTerms: extractTopicTerms(surroundingContext)
    })
  }
  return citations
}

// Find every financial figure claim in the document with its own topic context
function extractFinancialClaims(articleContent: string): Claim[] {
  const claims: Claim[] = []
  const claimPattern = /\bup to (\d+%|£\d+)\b/gi
  let match

  while ((match = claimPattern.exec(articleContent)) !== null) {
    const contextStart = Math.max(0, match.index - 200)
    const contextEnd = Math.min(articleContent.length, match.index + 200)
    const surroundingContext = articleContent.slice(contextStart, contextEnd)

    claims.push({
      text: match[0],
      position: match.index,
      topicTerms: extractTopicTerms(surroundingContext)
    })
  }
  return claims
}

// The core binding check: does ANY citation in the whole document share
// meaningful topic overlap with this claim? This is the fix — document-wide
// entity matching, not character-distance proximity.
function findBoundCitation(claim: Claim, allCitations: Citation[]): Citation | undefined {
  for (const citation of allCitations) {
    const sharedTerms = Array.from(claim.topicTerms).filter(t => citation.topicTerms.has(t))
    // Require at least 2 shared meaningful topic words (e.g. "ozev", "grant",
    // "charger") between the claim's context and a citation's context anywhere
    // in the document — this is the claim-to-citation binding
    if (sharedTerms.length >= 2) return citation
  }
  return undefined
}

function isClaimBoundToCitation(claim: Claim, allCitations: Citation[]): boolean {
  return !!findBoundCitation(claim, allCitations)
}

const INLINE_VERIFY_RE =
  /\b(verify|confirm|check|see|refer to)\b.{0,40}\b(gov\.uk|government|official)/i

function claimHasInlineVerification(articleContent: string, claim: Claim): boolean {
  const localContext = articleContent.slice(
    Math.max(0, claim.position - 150),
    Math.min(articleContent.length, claim.position + 150),
  )
  // Strip tags so href="https://www.gov.uk/..." cannot satisfy "see … GOV.UK"
  // when the visible text is only "See also vehicle tax".
  const plain = localContext.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  return INLINE_VERIFY_RE.test(plain)
}

/**
 * Grant/financial figures via claim-level evidence (Phase 5).
 *
 * Policy (GRANT_FIGURE_CITATION_POLICY = claim-level-once):
 * - One supporting citation covers every restatement of the SAME figure
 *   (do not require the link after every sentence).
 * - A citation that supports claim A does NOT automatically support claim B
 *   (different figures / unsupported topics stay flagged).
 *
 * When `freshnessCoveredFigures` is provided, skip figures already represented
 * as dated-policy / freshness issues.
 */
export function evaluateGrantFigureClaims(
  articleContent: string,
  freshnessCoveredFigures?: Set<string>,
): QualityIssue[] {
  const issues: QualityIssue[] = []
  const evidence = evaluateClaimEvidence(articleContent).filter((ev) =>
    isGrantFigureOwnedClaim(ev),
  )

  for (const ev of evidence) {
    const figureKey = (ev.figureText || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const identity = ev.figureText ? normalizeClaimFigureIdentity(ev.figureText) : ''
    if (
      (figureKey && freshnessCoveredFigures?.has(figureKey)) ||
      (identity && freshnessCoveredFigures?.has(identity))
    ) {
      continue
    }

    const hedgeClaim: Claim = {
      text: ev.figureText || ev.claimText.slice(0, 40),
      position: 0,
      topicTerms: new Set(),
    }
    const claims = extractFinancialClaims(articleContent).filter((c) => {
      const a = normalizeClaimFigureIdentity(c.text)
      const b = identity || normalizeClaimFigureIdentity(ev.figureText || '')
      return a === b
    })
    const representative = claims[0] || {
      text: ev.figureText || '',
      position: 0,
      topicTerms: new Set(),
    }
    hedgeClaim.position = representative.position
    hedgeClaim.topicTerms = representative.topicTerms

    const anyInlineVerification =
      claims.some((c) => claimHasInlineVerification(articleContent, c)) ||
      claimHasInlineVerification(articleContent, hedgeClaim)

    let status = ev.status
    if (anyInlineVerification && (status === 'UNSUPPORTED' || status === 'NEEDS_REVIEW')) {
      status = 'PARTIALLY_SUPPORTED'
    }

    const decision = decideClaimIssue({
      evidenceStatus: status,
      freshnessStatus: defaultFreshnessForEvidence(status),
      material: true,
      figureText: ev.figureText,
      claimKind: ev.claimKind,
    })
    if (decision.severity === null) continue

    const countNote =
      ev.occurrenceCount > 1 ? ` (appears ${ev.occurrenceCount} times)` : ''
    // Location is visible claim text — never a raw-HTML prefix at position 0.
    const location = stripHtmlSnippet(ev.claimText).slice(0, 120)

    const isUnsupported = status === 'UNSUPPORTED' || status === 'NEEDS_REVIEW'
    const category: IssueCategory = 'grant-figure'

    const evidenceBlock = formatClaimEvidenceDescription({
      ...ev,
      status,
      rationale:
        anyInlineVerification && isUnsupported
          ? `Inline verify hedge present.${ev.occurrenceCount > 1 ? ` Claim appears ${ev.occurrenceCount} times — one citation/hedge covers every restatement.` : ''}`
          : ev.rationale,
    })

    issues.push({
      id: `fact-grant-figure-${ev.claimId}`,
      severity: decision.severity,
      category,
      title: decision.title,
      explanation: decision.explanation,
      evidence: evidenceBlock,
      remediation: decision.fixStatus === 'NO_FIX_NEEDED'
        ? undefined
        : decision.severity === 'critical' && !ev.source
          ? 'Add an official source that states this figure, or remove the claim.'
          : 'Confirm the official page states this figure, then re-run Quality Gate.',
      fixStatus: decision.fixStatus,
      dimension: decision.dimension,
      description:
        [
          decision.explanation,
          evidenceBlock,
          countNote ? `Found: "${ev.figureText}"${countNote}` : `Found: "${ev.figureText}"`,
          `Evidence status: ${decision.evidenceStatus}`,
          `Freshness status: ${decision.freshnessStatus}`,
        ].join('\n'),
      location,
      citationUrl: ev.source?.url,
      figureText: ev.figureText,
      evidenceStatus: decision.evidenceStatus,
      freshnessStatus: decision.freshnessStatus,
      affectsDimensions: [decision.dimension, ...decision.alsoAffects],
      blocking: decision.blocking,
      autoFixable: isUnsupported && !anyInlineVerification && !ev.source && decision.severity === 'critical',
      autoFixDescription:
        isUnsupported && !anyInlineVerification && !ev.source
          ? 'Auto-fix adds "(verify at GOV.UK)" after each instance of this figure'
          : undefined,
    })
  }
  return issues
}

/**
 * Important factual claims that are not grant-figure autofix targets —
 * surfaces claim-level evidence gaps without requiring a cite after every sentence.
 */
export function evaluateClaimEvidenceIssues(articleContent: string): QualityIssue[] {
  const issues: QualityIssue[] = []
  const evidence = evaluateClaimEvidence(articleContent)
  for (const ev of evidence) {
    // Complementary skip: grant-figure owns material policy/grant figures.
    if (isGrantFigureOwnedClaim(ev)) continue
    const decision = decideClaimIssue({
      evidenceStatus: ev.status,
      freshnessStatus: defaultFreshnessForEvidence(ev.status),
      material: false,
      figureText: ev.figureText,
      claimKind: ev.claimKind,
    })
    if (decision.severity === null) continue
    const category: IssueCategory = 'claim-evidence'
    issues.push({
      id: `claim-evidence-${ev.claimId}`,
      severity: decision.severity,
      category,
      title: decision.title,
      explanation: decision.explanation,
      evidence: formatClaimEvidenceDescription(ev),
      remediation: decision.fixStatus === 'NO_FIX_NEEDED'
        ? undefined
        : 'Add or tighten an official source that supports this specific claim.',
      fixStatus: decision.fixStatus,
      dimension: decision.dimension,
      description: [decision.explanation, formatClaimEvidenceDescription(ev)].join('\n'),
      location: stripHtmlSnippet(ev.claimText).slice(0, 120),
      citationUrl: ev.source?.url,
      figureText: ev.figureText,
      evidenceStatus: decision.evidenceStatus,
      freshnessStatus: decision.freshnessStatus,
      affectsDimensions: [decision.dimension, ...decision.alsoAffects],
      blocking: decision.blocking,
      autoFixable: false,
    })
  }
  return issues
}

/** One issue per figure identity — grant-figure wins over claim-evidence if both fire. */
export function dedupeFactualClaimIssues(issues: QualityIssue[]): QualityIssue[] {
  const byKey = new Map<string, QualityIssue>()
  const passthrough: QualityIssue[] = []
  for (const i of issues) {
    if (i.category !== 'grant-figure' && i.category !== 'claim-evidence') {
      passthrough.push(i)
      continue
    }
    const key = i.figureText
      ? `fig:${normalizeClaimFigureIdentity(i.figureText)}`
      : i.id
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, i)
      continue
    }
    if (existing.category === 'claim-evidence' && i.category === 'grant-figure') {
      byKey.set(key, i)
    }
  }
  return [...passthrough, ...Array.from(byKey.values())]
}

export function collectFactualClaimIssues(
  articleContent: string,
  freshnessCoveredFigures?: Set<string>,
): QualityIssue[] {
  return dedupeFactualClaimIssues([
    ...evaluateGrantFigureClaims(articleContent, freshnessCoveredFigures),
    ...evaluateClaimEvidenceIssues(articleContent),
  ])
}

/** @deprecated Use evaluateClaimEvidence — exported for tests/debug. */
export function getClaimEvidenceForArticle(articleContent: string): ClaimEvidence[] {
  return evaluateClaimEvidence(articleContent)
}

function stripHtmlSnippet(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
}

export interface TimeAnchoredClaimFailure {
  claim: TimeAnchoredClaim
  severity: 'FAIL'
  reasons: string[]
}

// Shared by validateTimeAnchoredClaims and buildTimeAnchoredClaimRecords: a
// TimeAnchoredClaim only carries a sentence + a character offset, not the
// Claim shape isClaimBoundToCitation/findBoundCitation expect — this builds
// that shape from the same local-window context extractFinancialClaims uses.
function pseudoClaimFor(articleContent: string, claim: TimeAnchoredClaim): Claim {
  const contextStart = Math.max(0, claim.charOffset - 200)
  const contextEnd = Math.min(articleContent.length, claim.charOffset + 200)
  const context = articleContent.slice(contextStart, contextEnd) || claim.sentence
  return {
    text: claim.extractedNumericValue || claim.sentence.slice(0, 60),
    position: claim.charOffset,
    topicTerms: extractTopicTerms(context),
  }
}

/**
 * C04 — time-anchored claims. A claim passes only when BOTH: (1) it's
 * bound to an outbound citation somewhere in the document — reusing the
 * SAME document-wide claim-citation binding used for grant figures above
 * (isClaimBoundToCitation / claimHasInlineVerification), not a new nearby-
 * proximity check — and (2) it carries a reviewBy date. Every claim from
 * detectTimeAnchoredClaims always carries a reviewBy (assertedOn + 180
 * days, computed at detection time), so condition (2) is a structural
 * guarantee in practice; it's still checked so a future caller that
 * hand-builds a TimeAnchoredClaim without one is caught rather than
 * silently passed.
 */
export function validateTimeAnchoredClaims(
  articleContent: string,
  claims: TimeAnchoredClaim[],
): TimeAnchoredClaimFailure[] {
  const citations = extractCitations(articleContent)
  const failures: TimeAnchoredClaimFailure[] = []

  for (const claim of claims) {
    const reasons: string[] = []
    const pseudoClaim = pseudoClaimFor(articleContent, claim)

    const boundToCitation =
      isClaimBoundToCitation(pseudoClaim, citations) ||
      claimHasInlineVerification(articleContent, pseudoClaim)
    if (!boundToCitation) {
      reasons.push('no outbound source link bound to this figure anywhere in the article')
    }
    if (!claim.reviewBy) {
      reasons.push('no review_by date set')
    }

    if (reasons.length > 0) {
      failures.push({ claim, severity: 'FAIL', reasons })
    }
  }

  return failures
}

/**
 * Shared by buildDatedPolicyIssues (generation-time) and the article-v2
 * route's post-repair re-issue step (time-anchored-claim-repair.ts) —
 * one place decides what a FAIL-tier time-anchored claim looks like as a
 * QualityIssue, so the two call sites can never drift out of sync.
 */
export function timeAnchoredClaimFailureToIssue(
  failure: TimeAnchoredClaimFailure,
  index: number,
  articleContent?: string,
): QualityIssue {
  const { claim, reasons } = failure
  let citationUrl: string | undefined
  if (articleContent) {
    const citations = extractCitations(articleContent)
    const bound = findBoundCitation(pseudoClaimFor(articleContent, claim), citations)
    citationUrl = bound?.url
  }
  // Shared freshness severity — unsourced / needs-review is WARNING, never a
  // divergent critical from a second detector path.
  return {
    id: `time-anchored-claim-${index}`,
    severity: FRESHNESS_REVIEW_SEVERITY,
    category: 'dated-policy',
    title: `Time-sensitive claim — confirm still current: "${claim.extractedNumericValue || claim.matchedPattern}"`,
    description: [
      `Claim: "${claim.sentence}"`,
      `Evidence: ${reasons.join('; ')}.`,
      `Recommended action: Add an official source link that states this figure, or label the claim as historical if it no longer applies.`,
      `Re-check by ${claim.reviewBy}.`,
    ].join('\n'),
    location: claim.sentence.slice(0, 100),
    figureText: claim.extractedNumericValue || undefined,
    citationUrl,
    autoFixable: false,
  }
}

export interface TimeAnchoredClaimRecord {
  claim: string
  sourceUrl: string | null
  assertedOn: string
  reviewBy: string
}

/**
 * Persistence shape for articles.time_anchored_claims — every claim
 * detectTimeAnchoredClaims finds (deduped by sentence), whether or not it
 * ended up bound to a citation, so a future background job can re-verify
 * each one by its reviewBy date rather than re-scanning the whole article.
 * sourceUrl is the citation URL actually bound to the claim, or null.
 */
export function buildTimeAnchoredClaimRecords(
  articleContent: string,
  now: Date = new Date(),
): TimeAnchoredClaimRecord[] {
  const claims = detectTimeAnchoredClaims(articleContent, now)
  const uniqueClaims = Array.from(new Map(claims.map(c => [c.sentence.trim(), c])).values())
  const citations = extractCitations(articleContent)

  return uniqueClaims.map(claim => {
    const pseudoClaim = pseudoClaimFor(articleContent, claim)
    const boundCitation = findBoundCitation(pseudoClaim, citations)
    return {
      claim: claim.sentence,
      sourceUrl: boundCitation?.url ?? null,
      assertedOn: claim.assertedOn,
      reviewBy: claim.reviewBy,
    }
  })
}

function extractTitleFromHtml(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return undefined
  const text = m[1].replace(/<[^>]+>/g, '').trim()
  return text || undefined
}

function extractMetaDescriptionFromHtml(html: string): string | undefined {
  const named = html.match(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
  )
  if (named?.[1]) return named[1].trim()
  const contentFirst = html.match(
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i,
  )
  return contentFirst?.[1]?.trim() || undefined
}

/**
 * Map a freshness finding → QualityIssue using the shared severity policy.
 */
export function freshnessFindingToIssue(
  finding: FreshnessFinding,
  index: number,
): QualityIssue | null {
  const severity = severityForFreshnessFinding(finding)
  if (severity === null) return null
  return {
    id: `freshness-${finding.detector}-${index}`,
    severity,
    category: 'dated-policy',
    title: freshnessIssueTitle(finding),
    description: buildFreshnessIssueDescription(finding),
    location: finding.sentence.slice(0, 100),
    figureText: finding.figureText,
    citationUrl: finding.citationUrl,
    autoFixable: false,
  }
}

/**
 * Authoritative dated-policy / freshness issues + stale-year findings.
 * Chrono, time-anchored, and relative factual claims all flow through
 * evaluateFreshnessSync so they cannot disagree on severity.
 */
export function buildDatedPolicyIssues(
  articleContent: string,
  opts?: {
    now?: Date
    title?: string
    metaDescription?: string
    /** Optional live/fixture evidence — never hard-coded figures in production. */
    evidenceFindings?: FreshnessFinding[]
  },
): QualityIssue[] {
  const now = opts?.now ?? new Date()
  const issues: QualityIssue[] = []

  try {
    const findings =
      opts?.evidenceFindings ??
      evaluateFreshnessSync(articleContent, { now })
    const forIssues = freshnessFindingsRequiringIssues(findings)
    for (let i = 0; i < forIssues.length; i++) {
      const issue = freshnessFindingToIssue(forIssues[i], i)
      if (issue) issues.push(issue)
    }
  } catch (err) {
    console.warn('[article-quality-gate] freshness evaluation failed:', err)
  }

  try {
    const publishYear = now.getFullYear()
    const title = opts?.title ?? extractTitleFromHtml(articleContent)
    const metaDescription =
      opts?.metaDescription ?? extractMetaDescriptionFromHtml(articleContent)
    const staleYears = detectStaleYearReferences(
      {
        title,
        headings: extractHeadingTexts(articleContent),
        metaDescription,
      },
      publishYear,
    )
    const uniqueStaleYears = Array.from(
      new Map(staleYears.map(s => [`${s.location}:${s.text}`, s])).values(),
    )
    for (let i = 0; i < uniqueStaleYears.length; i++) {
      const s = uniqueStaleYears[i]
      issues.push({
        id: `stale-year-${i}`,
        severity: DATED_POLICY_SEVERITY,
        category: 'dated-policy',
        title: `Stale year in ${s.location}: "${s.year}" (article is dated ${publishYear})`,
        description: `${s.location === 'title' ? 'Title' : s.location === 'heading' ? 'A heading (and its table-of-contents entry)' : 'The meta description'} says "${s.text}" — mentions ${s.year}, but this article's datePublished/dateModified/"Last verified" line all say ${publishYear}. Update the year or confirm it's intentional (e.g. a genuine historical reference).`,
        location: s.text.slice(0, 100),
        autoFixable: false,
      })
    }
  } catch (err) {
    console.warn('[article-quality-gate] stale-year detection failed:', err)
  }

  return issues
}

/**
 * Async dated-policy build with optional Phase 13 research provider.
 * Article "Last updated" is never used as evidence (stripped in evaluator).
 */
export async function buildDatedPolicyIssuesAsync(
  articleContent: string,
  opts?: {
    now?: Date
    title?: string
    metaDescription?: string
    freshnessResearchProvider?: FreshnessResearchProvider
  },
): Promise<QualityIssue[]> {
  if (!opts?.freshnessResearchProvider) {
    return buildDatedPolicyIssues(articleContent, opts)
  }
  const findings = await evaluateFreshness(articleContent, {
    now: opts.now,
    evidenceProvider: evidenceProviderFromResearch(opts.freshnessResearchProvider),
  })
  return buildDatedPolicyIssues(articleContent, {
    now: opts.now,
    title: opts.title,
    metaDescription: opts.metaDescription,
    evidenceFindings: findings,
  })
}

/** Figures already represented by freshness dated-policy issues. */
export function freshnessCoveredFigureKeys(html: string, now?: Date): Set<string> {
  const findings = evaluateFreshnessSync(html, { now })
  const keys = new Set<string>()
  const add = (figure?: string) => {
    if (!figure) return
    keys.add(figure.toLowerCase().replace(/\s+/g, ' ').trim())
    keys.add(normalizeClaimFigureIdentity(figure))
  }
  for (const f of freshnessFindingsRequiringIssues(findings)) {
    add(f.figureText)
  }
  for (const f of findings) {
    if (f.evidenceStatus === 'SUPPORTED' && f.figureText) {
      add(f.figureText)
    }
  }
  return keys
}

// Duplicate-word and repeated-character checks used to live here as regexes
// too. Both are now handled by prose-linter.ts's retext pipeline instead:
// retext-repeated-words is tokenization-aware (won't cross HTML/attribute
// boundaries the way a raw regex risks), and the old repeated-character
// regex is dropped entirely rather than replaced — it had no way to tell a
// genuine typo ("reeeally") from a legitimate repeated letter in a brand
// name or chemical formula, and no retext plugin covers that narrow case
// safely either. The two merge-artifact patterns below are a different,
// narrowly-scoped, low-false-positive-risk mechanism specific to this app's
// LLM-generation pipeline (not a general prose-style concern retext
// addresses) and are kept as-is.
// A domain mention in visible text (e.g. "...at energynetworks.org. Skipping
// this step...") has the exact shape both merge-artifact patterns below look
// for — period, short lowercase run, period, capital letter — because a TLD
// is 2-4 lowercase letters ending in a period, immediately before a new
// sentence's capital letter. This is confirmed to false-positive on
// perfectly well-formed sentences (e.g. after the citation-link validator
// strips a dead link's <a> tag and leaves the bare domain as plain text).
// Domain-like tokens must be masked before COPY_ERROR_PATTERNS match —
// shared helper (case-preserving, length-preserving) lives in
// sentence-boundaries.ts so scannability / integrity / QG never diverge.
export { maskDomainLikeTokens } from './sentence-boundaries'
import { maskDomainLikeTokens } from './sentence-boundaries'

const COPY_ERROR_PATTERNS = [
  {
    pattern: /\.\s*[a-z]{1,4}\.\s+[A-Z]/g,
    message: 'Possible broken paragraph merge — short fragment between sentences',
    severity: 'critical' as const,
    category: 'merge-artifact' as const,
  },
  {
    pattern: /\b[a-z]{2,}\.\s?[a-z]\s[a-z]{2,}/g,
    message: 'Likely truncated word or merged sentence — a word appears to be cut off mid-way',
    severity: 'critical' as const,
    category: 'merge-artifact' as const,
  },
  {
    pattern: /\b[A-Za-z]{3,}\.[a-z]\s+[A-Z][a-z]+/g,
    message: 'Stray period mid-word (e.g. "Network.s Association") — merge artifact',
    severity: 'critical' as const,
    category: 'merge-artifact' as const,
  },
  {
    pattern: /\b\d+[a-zA-Z]*\.\s+[a-z]{2,}\b/g,
    message: 'Stray period after number or unit (e.g. "22kW. units") — merge artifact',
    severity: 'critical' as const,
    category: 'merge-artifact' as const,
  },
]

// Found while building the retext replacement above: the "missing space
// after period" check matches ANY lowercase-dot-lowercase sequence, which
// means a domain name mentioned in visible text (e.g. "ofgem.gov.uk" matches
// RULE 1's regexes are typo/copy-error checks meant for prose. Run against
// raw HTML they also match inside attribute values (e.g. style="border-radius:0
// 8px 8px 0" reads as a duplicate word "8px 8px"). Strip markup and attribute
// values first so only visible text is checked.
function stripHtmlForTextChecks(html: string): string {
  return html
    .replace(/href="[^"]*"/gi, '')
    .replace(/src="[^"]*"/gi, '')
    .replace(/style="[^"]*"/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Two visually-separated lines (e.g. an "About the Author" label
    // followed by <br> then the bio text) shouldn't glue into a run-on
    // sentence once tags are stripped — that read as a merge-artifact
    // false-positive. Insert a sentence boundary at line/block breaks
    // before the generic tag-strip below removes that structure.
    .replace(/<br\s*\/?>/gi, '. ')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim()
}

function countTypically(content: string): number {
  return (content.match(/\btypically\b/gi) || []).length
}

// ============================================================
// QUALITY ISSUE TYPES
// ============================================================

export type IssueSeverity = 'critical' | 'warning' | 'info'
export type IssueCategory =
  | 'typo'
  | 'merge-artifact'
  | 'grant-figure'
  | 'claim-evidence'
  | 'dated-policy'
  | 'ai-slop'
  | 'hedging'
  | 'cross-brand-link'
  | 'broken-citation-link'
  | 'schema'
  | 'missing-author'
  | 'missing-brand'
  | 'missing-date'
  | 'word-count'
  | 'fact-density'
  | 'image-completeness'
  | 'heading-hierarchy'
  | 'image-placement'
  | 'scannability'
  | 'heading-rhythm'
  | 'brief-coverage'
  | 'secondary-keyword-coverage'
  | 'topic-alignment'
  | 'brand-mismatch'
  | 'score-floor'

export interface QualityIssue {
  id: string
  severity: IssueSeverity
  category: IssueCategory
  title: string
  description: string
  location?: string
  autoFixable: boolean
  autoFixDescription?: string
  /** One concrete next step for the writer — never just "manual review". */
  actionHint?: string
  /** Bound official citation URL when one exists for this claim. */
  citationUrl?: string
  /** Extracted figure text (e.g. "up to £350") for citation auto-verify. */
  figureText?: string
  verificationStatus?: CitationVerifyStatus
  verificationDetail?: string
  /** Canonical claim-evidence axis (when applicable). */
  evidenceStatus?: string
  /** Canonical freshness/time axis (when applicable). */
  freshnessStatus?: string
  /** Primary dimension owner (from decideClaimIssue). */
  dimension?:
    | 'factual_verification'
    | 'freshness'
    | 'technical_seo'
    | 'structured_data'
    | 'readability'
    | 'internal_linking'
    | 'editorial'
  /** Extra explainable dimensions this issue must affect (no silent PASS). */
  affectsDimensions?: Array<
    | 'factual_verification'
    | 'freshness'
    | 'technical_seo'
    | 'structured_data'
    | 'readability'
    | 'internal_linking'
    | 'editorial'
  >
  /** True when this issue alone blocks publish. */
  blocking?: boolean
  /** Decision-layer explanation (mirrors decideClaimIssue.explanation). */
  explanation?: string
  /** Structured evidence line(s) for the UI. */
  evidence?: string
  /** Concrete remediation (actionHint preferred when both set). */
  remediation?: string
  /** Auto-fix / review lifecycle from the decision policy. */
  fixStatus?:
    | 'AUTO_FIX_ATTEMPTED'
    | 'AUTO_FIX_FAILED'
    | 'AUTO_FIX_CONFIRMED'
    | 'MANUAL_REVIEW_REQUIRED'
    | 'NO_FIX_NEEDED'
}

export interface QualityGateResult {
  passed: boolean
  score: number
  issues: QualityIssue[]
  criticalCount: number
  warningCount: number
  /**
   * Confirmed resolved issues after revalidation — NOT raw mutation attempts.
   * Phase 9: only increments when the original issue is gone on final HTML.
   */
  autoFixedCount: number
  articleAfterAutoFix: string
  readyToPublish: boolean
  blockers: string[]
  /** Phase 9 honest autofix report (optional for older callers). */
  autoFixConfirmation?: AutoFixConfirmation
  /** Phase 10 — dimension board + explainable aggregation (info never reduces score). */
  explainable: ExplainableScoreResult
}

/** Recompute score/counts/ready from the current issues list (single source of truth). */
export function recomputeQualityGateTotals(
  gate: Pick<QualityGateResult, 'issues' | 'autoFixedCount' | 'articleAfterAutoFix'> &
    Partial<Pick<QualityGateResult, 'passed' | 'score' | 'criticalCount' | 'warningCount' | 'readyToPublish' | 'blockers' | 'explainable'>>,
): QualityGateResult {
  const issues = gate.issues
  const criticalCount = issues.filter(i => i.severity === 'critical').length
  const warningCount = issues.filter(i => i.severity === 'warning').length
  const explainable = buildExplainableScore(issues)
  // Score is always the deterministic severity aggregation — never a blended mystery.
  const score = explainable.score
  const passed = criticalCount === 0
  const readyToPublish = explainable.publishDecision === 'READY'
  const blockers = issues
    .filter(i =>
      i.blocking === true ||
      i.severity === 'critical' ||
      i.id === 'missing-brand' ||
      i.id === 'brand-mismatch'
    )
    .map(i => `[${i.category.toUpperCase()}] ${i.title}`)

  return {
    passed,
    score,
    issues,
    criticalCount,
    warningCount,
    autoFixedCount: gate.autoFixedCount,
    articleAfterAutoFix: gate.articleAfterAutoFix,
    readyToPublish,
    blockers,
    explainable,
  }
}

/** Honest pipeline-stage status for a finished Quality Gate reading. */
export function qualityGateStageStatus(gate: Pick<QualityGateResult, 'autoFixedCount' | 'criticalCount' | 'warningCount' | 'passed'>): {
  status: 'pass' | 'fail' | 'fixed' | 'partial'
  detailSuffix: string
} {
  const open = gate.criticalCount + gate.warningCount
  if (gate.criticalCount > 0) {
    return { status: 'fail', detailSuffix: `${open} issue(s) remain` }
  }
  if (open > 0 && gate.autoFixedCount > 0) {
    return { status: 'partial', detailSuffix: `partially fixed, ${open} issue(s) remain` }
  }
  if (open > 0) {
    return { status: 'fail', detailSuffix: `${open} issue(s) remain` }
  }
  if (gate.autoFixedCount > 0) {
    return { status: 'fixed', detailSuffix: `${gate.autoFixedCount} auto-fixed` }
  }
  return { status: 'pass', detailSuffix: 'no open issues' }
}

/**
 * Schema + FAQ-parity issues for a given HTML snapshot.
 * Used for the initial RULE 6 pass AND the post-autofix refresh so the
 * returned Quality Gate issues always describe articleAfterAutoFix.
 */
const MIN_PRIMARY_IMAGE_WIDTH_PX = 1200

export function collectSchemaQualityIssues(
  html: string,
  expectOrganizationLogo?: boolean,
  primaryImageWidth?: number,
): QualityIssue[] {
  const schemaResult = validateSchema(html, { expectOrganizationLogo })
  const out: QualityIssue[] = []

  for (const schemaIssue of schemaResult.issues) {
    out.push({
      id: `schema-${schemaIssue.schemaType}-${schemaIssue.property}`,
      severity: schemaIssue.severity === 'error' ? 'critical' : 'warning',
      category: 'schema',
      title: `${schemaIssue.schemaType}: ${schemaIssue.property}`,
      description: schemaIssue.message,
      autoFixable: false,
    })
  }

  // M06 — Google's Top Stories/Discover eligibility needs a primary image
  // at least 1200px wide; an 800x450 featured image does not qualify. Only
  // checked when the pipeline actually knows the shipped image's width
  // (primaryImageWidth undefined means "unknown", not "missing" — no issue).
  if (primaryImageWidth !== undefined && primaryImageWidth < MIN_PRIMARY_IMAGE_WIDTH_PX) {
    out.push({
      id: 'schema-Article-image-width',
      severity: 'critical',
      category: 'schema',
      title: 'Article: image width',
      description: `Primary image is ${primaryImageWidth}px wide — Google requires at least ${MIN_PRIMARY_IMAGE_WIDTH_PX}px for Top Stories and Discover eligibility.`,
      autoFixable: false,
    })
  }

  const parsedFaqsForParity = parseFAQsFromArticle(html).faqs
  const hasVisibleFAQ =
    parsedFaqsForParity.length >= 2 ||
    /class=["'][^"']*faq-item/i.test(html) ||
    /<h2[^>]*>\s*(?:Frequently Asked Questions|FAQ|FAQs)\s*<\/h2>/i.test(html)
  if (hasVisibleFAQ && !schemaResult.schemasFound.includes('FAQPage')) {
    out.push({
      id: 'schema-faq-parity',
      severity: 'critical',
      category: 'schema',
      title: 'FAQPage schema missing but FAQ content exists',
      description: 'Visible FAQ section found but no FAQPage JSON-LD schema. Schema must match visible content.',
      autoFixable: true,
      autoFixDescription: 'Auto-fix injects FAQPage JSON-LD from the visible FAQ pairs',
    })
  }

  return out
}

// Every image is meant to be validated (uploaded + resolvable) before
// injection — this catches the case where the whole provider chain
// (Gemini → Pexels → pollinations.ai → Replicate) failed for a slot, which
// silently omits that figure rather than shipping a broken <img>. This rule
// only runs when a caller actually generated images and tells the gate how
// many to expect; callers that don't touch images (Improve, etc.) skip it.
export function checkImageCompleteness(articleContent: string, expectedImageCount: number): QualityIssue[] {
  const actualImageCount = (articleContent.match(/<img[^>]+src=/gi) || []).length

  if (actualImageCount < expectedImageCount) {
    return [{
      id: 'image-count-mismatch',
      severity: 'warning',
      category: 'image-completeness',
      title: `${expectedImageCount - actualImageCount} image(s) failed to generate`,
      description: `This article was supposed to have ${expectedImageCount} images but only has ${actualImageCount}. Every image provider (Gemini, Pexels, pollinations.ai) failed for at least one slot — check API keys and daily rate limits, or manually add an image for the missing section.`,
      autoFixable: false
    }]
  }
  return []
}

function consolidateDuplicateIssues(issues: QualityIssue[]): QualityIssue[] {
  const grouped = new Map<string, QualityIssue[]>()

  for (const issue of issues) {
    const key = `${issue.category}-${issue.title}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(issue)
  }

  const consolidated: QualityIssue[] = []
  for (const group of Array.from(grouped.values())) {
    if (group.length === 1) {
      consolidated.push(group[0])
    } else {
      consolidated.push({
        ...group[0],
        title: `${group[0].title} (appears ${group.length} times)`,
        description: `${group[0].description} This same figure is restated ${group.length} times throughout the article — confirm it's accurate everywhere it appears.`,
      })
    }
  }
  return consolidated
}

// Proves the NLP gap-analysis brief (entities + subtopics fed into the write
// prompt — see buildMasterPrompt's KEY ENTITIES / SUBTOPICS TO COVER lines)
// was genuinely used, not just passed through and ignored: closes the loop
// the same way checkImageCompleteness proves image generation actually ran.
export function checkBriefCoverage(
  articleContent: string,
  brief?: { entities: string[]; topicalGaps: string[] },
): QualityIssue[] {
  if (!brief || (brief.entities.length === 0 && brief.topicalGaps.length === 0)) return []

  const plainText = articleContent.replace(/<[^>]+>/g, ' ').toLowerCase()
  const entitiesCovered = brief.entities.filter(e => plainText.includes(e.toLowerCase()))
  // A subtopic is a phrase ("permit fees and inspection costs") — treat it as
  // covered if any one of its own significant words shows up, not the exact
  // phrase verbatim (the article will paraphrase, not quote the gap label).
  const subtopicsCovered = brief.topicalGaps.filter(s =>
    s.toLowerCase().split(/\s+/).some(word => word.length > 4 && plainText.includes(word))
  )

  const totalTargets = brief.entities.length + brief.topicalGaps.length
  const coveragePercent = totalTargets === 0
    ? 100
    : Math.round(((entitiesCovered.length + subtopicsCovered.length) / totalTargets) * 100)

  return [{
    id: 'brief-coverage',
    severity: coveragePercent < 40 ? 'warning' : 'info',
    category: 'brief-coverage',
    title: `Gap-analysis coverage: ${coveragePercent}% (${entitiesCovered.length}/${brief.entities.length} entities, ${subtopicsCovered.length}/${brief.topicalGaps.length} subtopics)`,
    description: coveragePercent < 40
      ? 'This article covers less than half of the identified gap-analysis targets from the NLP brief. Consider running Improve to work in more of the missing entities/subtopics.'
      : 'Good coverage of the identified content gaps from the NLP brief.',
    autoFixable: false,
  }]
}

// The write prompt marks secondary/cluster keywords MANDATORY (see
// buildMasterPrompt's SECONDARY KEYWORDS line), but a prompt instruction is
// a request, not a guarantee — same lesson as merge-artifact-repair.ts and
// scannability-fixer.ts. Confirmed in production: a 14-term cluster for "ev
// charger" silently lost several terms with no warning anywhere. This
// checks the actual output and names exactly which ones are missing, rather
// than the UI's previous blanket "✓ will also weave in [full list]" promise.
const STEM_SUFFIXES = /(ations?|ing|ers?|ed|es|s)$/
function stem(word: string): string {
  return word.length > 5 ? word.replace(STEM_SUFFIXES, '') : word
}

export function checkSecondaryKeywordCoverage(articleContent: string, secondaryKeywords: string[]): QualityIssue[] {
  if (!secondaryKeywords || secondaryKeywords.length === 0) return []

  const plainText = articleContent.replace(/<[^>]+>/g, ' ').toLowerCase()
  const articleWordStems = new Set(
    plainText.split(/[^a-z0-9]+/).filter(w => w.length > 3).map(stem)
  )

  const missing: string[] = []
  for (const kw of secondaryKeywords) {
    const kwLower = kw.toLowerCase().trim()
    if (!kwLower) continue
    if (plainText.includes(kwLower)) continue // exact phrase present

    // Natural-variant tolerance: covered if every significant word of the
    // phrase (stemmed) appears somewhere in the article, regardless of
    // order or intervening words — "installing an EV charger" satisfies
    // "ev charger installation" this way without requiring an exact match.
    const sigWords = kwLower.split(/\s+/).filter(w => w.length > 3)
    const covered = sigWords.length > 0 && sigWords.every(w => articleWordStems.has(stem(w)))
    if (!covered) missing.push(kw)
  }

  if (missing.length === 0) return []

  return [{
    id: 'secondary-keyword-coverage',
    severity: 'warning',
    category: 'secondary-keyword-coverage',
    title: `${missing.length}/${secondaryKeywords.length} secondary keyword(s) missing from the article`,
    description: `Requested but not found (as an exact phrase or a natural variant): ${missing.join(', ')}. The write prompt marks these mandatory — consider running Improve to work them in, or confirm they're not actually relevant to this article's angle.`,
    autoFixable: false,
  }]
}

/** Known rivals / frequent hallucinations — block if they appear when brand is set. */
const RIVAL_BRAND_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bauto\s*trader(?:\.com)?\b/i, label: 'Auto Trader' },
  { re: /\bautotrader(?:\.com)?\b/i, label: 'Auto Trader' },
  { re: /\bwhat\s*car\??\b/i, label: 'What Car' },
  { re: /\bparkers\b/i, label: 'Parkers' },
  { re: /\bcarwow\b/i, label: 'Carwow' },
  { re: /\bzap-?map\b/i, label: 'Zapmap' },
]

export function detectWrongBrandInBody(articleContent: string, brand: string): QualityIssue | null {
  const expected = brand.trim()
  if (!expected) return null
  const expectedNorm = expected.toLowerCase().replace(/[^a-z0-9]/g, '')
  const plain = articleContent
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')

  for (const { re, label } of RIVAL_BRAND_PATTERNS) {
    const labelNorm = label.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (expectedNorm.includes(labelNorm) || labelNorm.includes(expectedNorm)) continue
    if (re.test(plain)) {
      return {
        id: 'brand-mismatch',
        severity: 'critical',
        category: 'brand-mismatch',
        title: `Wrong brand in article body: "${label}" (configured brand is "${expected}")`,
        description: `Body text mentions "${label}", which is not your configured brand. This is a brand-safety failure — do not publish until the body uses "${expected}" only.`,
        autoFixable: true,
        autoFixDescription: `Replace "${label}" with "${expected}"`,
      }
    }
  }

  // "At SomeCompany," intro that isn't the configured brand
  const atMatch = plain.match(/\bAt\s+([A-Z][A-Za-z0-9 .'-]{1,40}?)\s*,\s*we\b/)
  if (atMatch) {
    const named = atMatch[1].replace(/\.com$/i, '').trim()
    const namedNorm = named.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (namedNorm && namedNorm !== expectedNorm && !expectedNorm.includes(namedNorm) && !namedNorm.includes(expectedNorm)) {
      return {
        id: 'brand-mismatch',
        severity: 'critical',
        category: 'brand-mismatch',
        title: `Intro names "${named}" but configured brand is "${expected}"`,
        description: `The opening "At ${named}, we…" does not match your brand setting. Regenerate or Fix All before publishing.`,
        autoFixable: true,
        autoFixDescription: `Rewrite intro to use "${expected}"`,
      }
    }
  }

  return null
}

/** Hard floors on individual metrics — a good blended score must not hide these. */
export function scoreFloorIssues(opts: {
  eeatScore?: number
  keywordDensityPct?: number
  keywordDensityScore?: number
  factSourcingScore?: number
  humanScore?: number
  keyword: string
}): QualityIssue[] {
  const out: QualityIssue[] = []
  const {
    eeatScore,
    keywordDensityPct,
    keywordDensityScore,
    factSourcingScore,
    humanScore,
    keyword,
  } = opts

  // E-E-A-T floor
  if (typeof eeatScore === 'number' && eeatScore < 50) {
    out.push({
      id: 'score-floor-eeat',
      severity: 'critical',
      category: 'score-floor',
      title: `E-E-A-T score ${eeatScore}/100 is below the publish floor (50)`,
      description: 'Experience, expertise, authoritativeness, or trust signals are too weak. Improve author byline, first-person experience, and authoritative citations before publishing.',
      autoFixable: true,
      autoFixDescription: 'Run Fix All / Improve E-E-A-T',
    })
  }

  // Keyword presence heuristic (Phase 12) — NOT a magic Google density rule.
  // Near-zero presence may indicate thin/off-topic coverage → REVIEW (warning),
  // never a critical "Google ranking floor."
  if (keywordPresenceHeuristic({ keywordDensityPct, keywordDensityScore }) === 'review') {
    out.push({
      id: 'score-floor-keyword-density',
      severity: 'warning',
      category: 'score-floor',
      title: `Primary phrase barely appears: "${keyword}" (${keywordDensityPct?.toFixed(1) ?? '0.0'}% / score ${keywordDensityScore ?? 0})`,
      description:
        'Heuristic coverage smell — the primary phrase rarely appears. This is not a Google ranking density target. Use the phrase naturally where it helps readers, or confirm the page is on-topic.',
      autoFixable: true,
      autoFixDescription: 'Run Fix All / strengthen natural primary-phrase coverage',
    })
  }

  // Fact sourcing floor (when score was computed)
  if (typeof factSourcingScore === 'number' && factSourcingScore < 40) {
    out.push({
      id: 'score-floor-fact-sourcing',
      severity: 'critical',
      category: 'score-floor',
      title: `Fact sourcing score ${factSourcingScore}/100 is below the publish floor (40)`,
      description: 'Too many unsourced claims remain. Add named-source attributions before publishing.',
      autoFixable: true,
      autoFixDescription: 'Run Fix All / Improve fact sourcing',
    })
  }

  // Human Score / AI-detection-risk floor — 72 is not a new arbitrary
  // number, it's the same threshold humanizer.ts already uses to compute
  // its own passesDetection flag. Confirmed live: an article scored 60/100
  // with an explicit "May trigger detection" warning still showed "Ready
  // to publish" at 90/100 overall, because human score fed the blended
  // score but had no floor of its own — same class of bug the E-E-A-T/
  // density/fact-sourcing floors above were added to close.
  if (typeof humanScore === 'number' && humanScore < 72) {
    out.push({
      id: 'score-floor-human-score',
      severity: 'critical',
      category: 'score-floor',
      title: `Human score ${humanScore}/100 is below the publish floor (72) — may trigger AI-content detection`,
      description: 'The humanizer\'s own detection-risk threshold was not met. Publishing content likely to be flagged as AI-generated risks the site\'s credibility and search visibility — run Humanize again or edit manually before publishing.',
      autoFixable: false,
    })
  }

  return out
}

// ============================================================
// MAIN QUALITY GATE FUNCTION
// ============================================================

// Fire-and-forget — logs every issue found so recurring-issue-detector.ts can
// tell "this keeps happening" (a pipeline/prompt bug) apart from "this one
// article had a typo" (a content fluke). Never throws, never blocks the
// response; a missing userId (article-v2 is not yet auth-gated) just means
// this run isn't logged.
async function logQualityGateRun(userId: string | undefined, articleId: string | undefined, issues: QualityIssue[]): Promise<void> {
  if (!userId || issues.length === 0) return
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.from('quality_gate_history').insert(
      issues.map(issue => ({
        user_id: userId,
        article_id: articleId ?? null,
        issue_category: issue.category,
        issue_id: issue.id,
        severity: issue.severity,
      }))
    )
  } catch (err) {
    console.error('[article-quality-gate] logQualityGateRun failed:', err)
  }
}

export async function runQualityGate(
  articleContent: string,
  options: {
    brand: string
    keyword: string
    authorName: string
    registeredLinkDomains: string[]
    minWordCount?: number
    maxWordCount?: number
    maxTypically?: number
    userId?: string
    articleId?: string
    expectedImageCount?: number
    brief?: { entities: string[]; topicalGaps: string[] }
    secondaryKeywords?: string[]
    extraIssues?: QualityIssue[]
    expectOrganizationLogo?: boolean
    /** Hard floors — force needs-review when any critical metric is too low. */
    eeatScore?: number
    keywordDensityPct?: number
    keywordDensityScore?: number
    factSourcingScore?: number
    humanScore?: number
    /**
     * Dated-policy context. Detection always runs inside the gate (so recheck
     * / Fix All match article-v2). Pass now/title/meta when known so stale-year
     * checks align with publish metadata.
     */
    datedPolicy?: {
      now?: Date
      title?: string
      metaDescription?: string
      evidenceFindings?: FreshnessFinding[]
    }
    /**
     * Phase 13 — optional research provider for time-sensitive claims.
     * When absent, gate uses article-local citations only (never article datelines).
     */
    freshnessResearchProvider?: FreshnessResearchProvider
    /**
     * Regression-harness use only: skips autoVerifyCitedPolicyIssues, the
     * one step in the gate that makes a real network fetch (re-checking a
     * cited GOV.UK-style page). Every other check is unaffected. Never set
     * this true on the live generation/recheck/Fix-All paths.
     */
    skipLiveVerification?: boolean
    /** M06 — pipeline-known width of the primary shipped image, in px. */
    primaryImageWidth?: number
    /**
     * M07 — the exact Organization.logo URL the schema actually emitted
     * (schemaResult.organizationLogoUrl), when set. When present and
     * !skipLiveVerification, a real HTTP request confirms it resolves to an
     * actual image before the schema/logo dimension counts as PASS — field
     * presence alone is not enough (see logo-reachability.ts).
     */
    organizationLogoUrl?: string
  }
): Promise<QualityGateResult> {

  const {
    brand,
    authorName,
    registeredLinkDomains,
    minWordCount = 800,
    maxWordCount,
    maxTypically = 5,
    userId,
    articleId,
    expectedImageCount,
    brief,
    keyword,
    secondaryKeywords,
    extraIssues,
    expectOrganizationLogo,
    eeatScore,
    keywordDensityPct,
    keywordDensityScore,
    factSourcingScore,
    humanScore,
    datedPolicy,
    freshnessResearchProvider,
    skipLiveVerification,
    primaryImageWidth,
    organizationLogoUrl,
  } = {
    expectOrganizationLogo: false,
    ...options,
  } as {
    brand: string
    authorName: string
    registeredLinkDomains: string[]
    minWordCount?: number
    maxWordCount?: number
    maxTypically?: number
    userId?: string
    articleId?: string
    expectedImageCount?: number
    brief?: { entities: string[]; topicalGaps: string[] }
    keyword: string
    secondaryKeywords?: string[]
    skipLiveVerification?: boolean
    primaryImageWidth?: number
    organizationLogoUrl?: string
    extraIssues?: QualityIssue[]
    expectOrganizationLogo?: boolean
    eeatScore?: number
    keywordDensityPct?: number
    keywordDensityScore?: number
    factSourcingScore?: number
    humanScore?: number
    datedPolicy?: {
      now?: Date
      title?: string
      metaDescription?: string
      evidenceFindings?: FreshnessFinding[]
    }
    freshnessResearchProvider?: FreshnessResearchProvider
  }

  let issues: QualityIssue[] = extraIssues ? [...extraIssues] : []
  let articleAfterAutoFix = articleContent

  // Dated-policy is owned by the gate (same severity on every pass). Drop any
  // caller-supplied dated-policy extras so article-v2 cannot diverge from
  // recheck / Fix All.
  issues = issues.filter(i => i.category !== 'dated-policy')
  if (datedPolicy?.evidenceFindings) {
    issues.push(...buildDatedPolicyIssues(articleContent, datedPolicy))
  } else {
    issues.push(
      ...(await buildDatedPolicyIssuesAsync(articleContent, {
        ...datedPolicy,
        freshnessResearchProvider,
      })),
    )
  }
  const freshnessFigures = freshnessCoveredFigureKeys(articleContent, datedPolicy?.now)

  // ---- RULE 0: Topic must match the requested keyword (blocks crypto-for-ev-charger disasters) ----
  const topicCheck = checkTopicAlignment(articleContent, keyword)
  if (!topicCheck.aligned) {
    issues.push({
      id: 'topic-alignment-failed',
      severity: 'critical',
      category: 'topic-alignment',
      title: `Article is not about "${options.keyword}"`,
      description: topicCheck.reason || 'Title and body do not match the requested keyword. Regenerate — do not publish.',
      location: topicCheck.h1Text ? `H1: ${topicCheck.h1Text.slice(0, 80)}` : undefined,
      autoFixable: false,
    })
  }

  // ---- RULE 1: Typos and copy errors ----
  // Checked against visible text only (see stripHtmlForTextChecks) so these
  // never false-positive on markup or attribute values like style="...8px 8px...".
  const textForCopyChecks = stripHtmlForTextChecks(articleContent)
  const domainMaskedText = maskDomainLikeTokens(textForCopyChecks)
  for (const rule of COPY_ERROR_PATTERNS) {
    const matches = domainMaskedText.match(rule.pattern)
    if (matches && matches.length > 0) {
      const idx = domainMaskedText.search(rule.pattern)
      const context = textForCopyChecks.slice(Math.max(0, idx - 30), idx + 60)
      issues.push({
        id: `copy-${rule.category}-${issues.length}`,
        severity: rule.severity,
        category: rule.category,
        title: rule.message,
        description: `Found ${matches.length} instance(s). Check near: "${context.trim().slice(0, 80)}"`,
        location: context.trim().slice(0, 100),
        autoFixable: false
      })
    }
  }

  // ---- RULE 1b: Tokenization-aware prose checks (retext) ----
  // Replaces the old duplicate-word and repeated-character regexes — see
  // prose-linter.ts for why. Reuses the same visible-text extraction as
  // RULE 1 above.
  try {
    const proseFindings = await lintProse(textForCopyChecks)
    for (const finding of proseFindings) {
      // Straight quotes/apostrophes are typographic style only (prose-linter
      // marks them info) — skip so they don't clutter the Quality Gate panel.
      if (finding.severity === 'info') continue
      issues.push({
        id: `prose-${finding.key}`,
        severity: finding.severity,
        category: 'typo',
        title: finding.title,
        description: `Found ${finding.count} instance(s)${finding.examples.length > 0 ? `, e.g. "${finding.examples.join('", "')}"` : ''}.`,
        autoFixable: false,
      })
    }
  } catch (proseErr) {
    console.warn('[article-quality-gate] prose lint failed, continuing:', proseErr)
  }

  // ---- RULE 2: Dated-policy / freshness is owned by buildDatedPolicyIssues
  // (evaluateFreshnessSync). No parallel DANGEROUS_FACT_PATTERNS pass.

  // ---- RULE 2b/2c: One canonical issue per claim identity.
  issues.push(...collectFactualClaimIssues(articleContent, freshnessFigures))

  // ---- RULE 3: AI slop patterns ----
  for (const pattern of AI_SLOP_PATTERNS) {
    const match = articleContent.match(pattern)
    if (match) {
      issues.push({
        id: `slop-${issues.length}`,
        severity: 'warning',
        category: 'ai-slop',
        title: `AI pattern detected: "${match[0]}"`,
        description: 'This phrase is a common AI-generated signal that reduces human score. Consider removing or rewriting.',
        location: match[0],
        autoFixable: true,
        autoFixDescription: 'Auto-fix removes this phrase from the article'
      })
    }
  }

  // ---- RULE 4: Semantic hedging (Phase 7) — not an arbitrary "typically" quota ----
  const hedging = evaluateHedging(articleContent)
  const wordCount = countArticleWords(articleContent)

  const realRep = hedging.actionable.filter((a) => a.classification === 'REAL_REPETITION')
  const overHedge = hedging.actionable.filter((a) => a.classification === 'OVER_HEDGING')
  const unsupportedHedge = hedging.actionable.filter((a) => a.classification === 'UNSUPPORTED_CLAIM')

  if (realRep.length >= 3 || (hedging.autoFixableTokens.includes('typically') && (hedging.byToken.typically || 0) >= 6)) {
    issues.push({
      id: 'hedging-real-repetition',
      severity: 'warning',
      category: 'hedging',
      title: `Repetitive hedge boilerplate detected (${realRep.length || hedging.byToken.typically || 0}×)`,
      description: `${hedging.summary} Class: REAL_REPETITION. Appropriate qualifications (may/can/approximately with variability) are not flagged.`,
      autoFixable: hedging.autoFixableTokens.length > 0,
      autoFixDescription: 'Auto-fix removes only obvious repetitive "typically" boilerplate — keeps valid uncertainty language',
    })
  }

  if (overHedge.length >= 4 || isExtremeHedgeDensity(hedging)) {
    issues.push({
      id: 'hedging-over',
      severity: 'warning',
      category: 'hedging',
      title: `Over-hedging — density ${hedging.densityPer100.toFixed(1)} per 100 words`,
      description: `${hedging.summary} Class: OVER_HEDGING. Reduce stacked hedges for clarity; this is not a Google keyword penalty.`,
      autoFixable: false,
    })
  }

  if (unsupportedHedge.length >= 2) {
    issues.push({
      id: 'hedging-unsupported',
      severity: 'info',
      category: 'hedging',
      title: `Hedge softens precise claims without variability context (${unsupportedHedge.length})`,
      description: `Class: UNSUPPORTED_CLAIM. Example: "${unsupportedHedge[0].sentence.slice(0, 120)}". Cite a source or state the range explicitly.`,
      autoFixable: false,
    })
  }

  // ---- RULE 5: Cross-brand link detection ----
  // Only scan real, clickable content links (<a href>) — not machine-only
  // tags like <link rel="canonical"> or <meta property="og:url">. Those
  // are self-referential page metadata, not outbound content links a
  // reader follows, so they aren't subject to the brand-safety registry
  // at all. Scanning raw href="https://..." anywhere in the HTML caught
  // the article's OWN canonical tag and would have auto-deleted it.
  const linkPattern = /<a\s[^>]*href=["']https?:\/\/([^/"']+)/gi
  let linkMatch
  while ((linkMatch = linkPattern.exec(articleContent)) !== null) {
    const linkedDomain = linkMatch[1].replace('www.', '')
    const isBrandSite = ['autodun.com', 'seoranko.com', 'fitford.com', 'minso', 'minsofurniture'].some(
      d => linkedDomain.includes(d)
    )
    if (!isBrandSite) continue
    const isRegistered = registeredLinkDomains.some(d => linkedDomain.includes(d))
    if (!isRegistered) {
      const context = articleContent.slice(Math.max(0, linkMatch.index - 30), linkMatch.index + 80)
      issues.push({
        id: `cross-brand-link-${issues.length}`,
        severity: 'critical',
        category: 'cross-brand-link',
        title: `Cross-brand link detected: ${linkedDomain}`,
        description: `Article brand is "${brand}" but this links to "${linkedDomain}" which is not in the registry for this brand.`,
        location: context.slice(0, 100),
        autoFixable: true,
        autoFixDescription: 'Auto-fix removes the cross-brand link and replaces it with plain text'
      })
    }
  }

  // ---- RULE 6: Schema validation (full schema.org property-level check) ----
  // Collected via shared helper so the post-autofix refresh below uses the
  // exact same rules (including FAQ parity).
  issues.push(...collectSchemaQualityIssues(articleContent, expectOrganizationLogo, primaryImageWidth))

  // ---- RULE 7: Author byline ----
  if (!articleContent.includes(authorName)) {
    issues.push({
      id: 'missing-author',
      severity: 'warning',
      category: 'missing-author',
      title: `Author name "${authorName}" not found in article`,
      description: 'Author byline is required for EEAT signals.',
      autoFixable: false
    })
  }

  // ---- RULE 7b: Brand context for publish ----
  // Brand-less generation is a valid draft/cross-market test. Warning (not
  // critical) so the gate score isn't crushed while testing; readyToPublish
  // is still forced false below when this issue is present.
  if (!brand) {
    issues.push({
      id: 'missing-brand',
      severity: 'warning',
      category: 'missing-brand',
      title: 'No brand set — draft only (set brand before publishing)',
      description: 'Generated without brand/site context, so internal linking, schema publisher identity, canonical URL, and OG tags fall back to placeholders. Fine for testing other markets/keywords; set a brand and regenerate before publishing.',
      autoFixable: false,
    })
  } else {
    // Brand-safety: block publish when body text names a rival / wrong company
    const brandMismatch = detectWrongBrandInBody(articleContent, brand)
    if (brandMismatch) issues.push(brandMismatch)
  }

  // ---- RULE 7c: Hard floors on individual scores (never hide behind a blended gate score) ----
  issues.push(...scoreFloorIssues({
    eeatScore,
    keywordDensityPct,
    keywordDensityScore,
    factSourcingScore,
    humanScore,
    keyword,
  }))

  // ---- RULE 8: Editorial word count (Phase 8) — USER_TARGET, not Google SEO ----
  // Deferred until after brief/secondary coverage so short+incomplete → CONTENT_COVERAGE.
  // Placeholder removed; see RULE 8b after brief coverage.

  // ---- RULE 9: Image completeness — every provider in the image chain failed for at least one slot ----
  if (expectedImageCount != null) {
    issues.push(...checkImageCompleteness(articleContent, expectedImageCount))
  }

  // ---- RULE 10: Article structure — heading hierarchy, scannability, heading rhythm ----
  // Phase 1 final-artifact pipeline runs Quality Gate AFTER image injection +
  // schema sync, so image-placement and scannability apply to the same HTML
  // that is saved/streamed (see buildFinalArticleArtifact).
  for (const structureIssue of validateArticleStructure(articleContent)) {
    issues.push({
      id: `structure-${structureIssue.category}-${issues.length}`,
      severity: structureIssue.severity,
      category: structureIssue.category,
      title: structureIssue.message,
      description: structureIssue.message,
      autoFixable: false,
    })
  }

  // ---- RULE 11: NLP gap-analysis brief coverage (only when a brief was provided) ----
  issues.push(...checkBriefCoverage(articleContent, brief))

  // ---- RULE 12: Secondary/cluster keyword coverage (mandatory per the write prompt) ----
  if (secondaryKeywords?.length) {
    issues.push(...checkSecondaryKeywordCoverage(articleContent, secondaryKeywords))
  }

  // ---- RULE 8b: Editorial word count (after coverage signals) ----
  {
    const preferred =
      maxWordCount != null
        ? Math.round((minWordCount + maxWordCount) / 2)
        : Math.round(minWordCount / 0.88)
    const coverageIncomplete = issues.some(
      (i) =>
        i.category === 'brief-coverage' ||
        i.category === 'secondary-keyword-coverage' ||
        i.category === 'topic-alignment',
    )
    const wcAssess = assessEditorialWordCount(wordCount, preferred, {
      absoluteMax: maxWordCount ?? null,
      coverageIncomplete,
      kind: 'USER_TARGET',
    })
    if (wcAssess.severity) {
      issues.push({
        id:
          wcAssess.classification === 'CONTENT_COVERAGE'
            ? 'word-count-coverage'
            : wcAssess.classification === 'OVER_MAXIMUM'
              ? 'word-count-high'
              : 'word-count-advisory',
        severity: wcAssess.severity,
        category: 'word-count',
        title: wcAssess.title,
        description: wcAssess.description,
        autoFixable: false,
      })
    }
  }

  // Snapshot pre-autofix issues for Phase 9 confirmation
  const issuesBeforeAutoFix = issues.map((i) => ({
    id: i.id,
    category: i.category,
    severity: i.severity,
    title: i.title,
  }))
  const scoreBeforeAutoFix = scoreFromIssues(issues)
  let mutationAttempts = 0

  // ---- AUTO-FIX PASS ----
  // Fix 0: Wrong brand in body → replace with configured brand
  if (brand && issues.some(i => i.id === 'brand-mismatch' && i.autoFixable)) {
    for (const { re, label } of RIVAL_BRAND_PATTERNS) {
      const labelNorm = label.toLowerCase().replace(/[^a-z0-9]/g, '')
      const brandNorm = brand.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (brandNorm.includes(labelNorm)) continue
      const fixed = applyGuardedRegexReplace(
        articleAfterAutoFix,
        re,
        () => brand,
        `brand-replace-${label}`,
      )
      if (fixed.appliedCount > 0) {
        articleAfterAutoFix = fixed.html
        mutationAttempts += fixed.appliedCount
      }
    }
    const introFix = applyGuardedRegexReplace(
      articleAfterAutoFix,
      /\bAt\s+(?!Kamran)([A-Z][A-Za-z0-9 .'-]{1,40}?)\s*,\s*we\b/g,
      (match, named: string) => {
        const n = named.replace(/\.com$/i, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
        const expected = brand.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (n === expected || expected.includes(n) || n.includes(expected)) return match
        return `At ${brand}, we`
      },
      'brand-intro-rewrite',
    )
    if (introFix.appliedCount > 0) {
      articleAfterAutoFix = introFix.html
      mutationAttempts += introFix.appliedCount
    }
  }

  // Fix 1: Remove cross-brand links (guarded)
  if (issues.some(i => i.category === 'cross-brand-link' && i.autoFixable)) {
    const linkFix = applyGuardedRegexReplace(
      articleAfterAutoFix,
      /<a[^>]*href=["'][^"']*["'][^>]*>([^<]*)<\/a>/gi,
      (match, anchorText: string) => {
        const hrefMatch = match.match(/href=["']https?:\/\/([^/"']+)/)
        if (!hrefMatch) return match
        const domain = hrefMatch[1].replace('www.', '')
        const isWrongBrand = ['autodun.com', 'seoranko.com', 'fitford.com'].some(d =>
          domain.includes(d) && !registeredLinkDomains.some(r => domain.includes(r))
        )
        if (isWrongBrand) return anchorText
        return match
      },
      'cross-brand-link-strip',
    )
    articleAfterAutoFix = linkFix.html
    mutationAttempts += linkFix.appliedCount
  }

  // Fix 2: Only remove REAL_REPETITION "typically" boilerplate (Phase 7)
  const hedgeRepIssue = issues.find(i => i.id === 'hedging-real-repetition' && i.autoFixable)
  if (hedgeRepIssue) {
    let kept = 0
    const keepLimit = Math.max(2, maxTypically)
    articleAfterAutoFix = transformHtmlTextNodes(articleAfterAutoFix, (text) => {
      const typFix = applyGuardedRegexReplace(
        text,
        /\btypically\b/gi,
        (match) => {
          kept++
          if (kept > keepLimit) return ''
          return match
        },
        'typically-real-repetition',
      )
      mutationAttempts += typFix.appliedCount
      return typFix.html.replace(/[^\S\n]{2,}/g, ' ')
    })
  }

  // Fix 3: Remove auto-fixable AI slop patterns — text nodes only
  for (const pattern of AI_SLOP_PATTERNS) {
    const slopIssue = issues.find(
      i => i.category === 'ai-slop' && i.autoFixable &&
      i.location && pattern.test(i.location)
    )
    if (slopIssue) {
      articleAfterAutoFix = transformHtmlTextNodes(articleAfterAutoFix, (text) => {
        const slopFix = applyGuardedRegexReplace(
          text,
          pattern,
          () => '',
          'ai-slop-remove',
        )
        mutationAttempts += slopFix.appliedCount
        return slopFix.html
      })
    }
  }

  // Fix 4: Grant-figure hedges — add "(verify at GOV.UK)" next to unsourced caps
  if (issues.some(i => i.category === 'grant-figure' && i.autoFixable)) {
    articleAfterAutoFix = transformHtmlTextNodes(articleAfterAutoFix, (text) => {
      const grantFix = applyGuardedRegexReplace(
        text,
        /\bup to (\d+%|£\d+)\b(?!\s*\(verify at GOV\.UK\))/gi,
        (match) => `${match} (verify at GOV.UK)`,
        'grant-figure-verify',
      )
      mutationAttempts += grantFix.appliedCount
      return grantFix.html
    })
  }

  // Fix 5: Inject FAQPage schema when FAQ content exists but schema is missing
  const faqParityIssue = issues.find(i => i.id === 'schema-faq-parity' && i.autoFixable)
  if (faqParityIssue) {
    const { faqs: faqPairs } = parseFAQsFromArticle(articleAfterAutoFix)
    const alreadyHasFaqPage =
      /"@type"\s*:\s*"FAQPage"/i.test(articleAfterAutoFix)
    if (faqPairs.length >= 2 && !alreadyHasFaqPage) {
      const faqSchema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqPairs.map(f => ({
          '@type': 'Question',
          name: f.question,
          acceptedAnswer: { '@type': 'Answer', text: f.answer },
        })),
      }
      articleAfterAutoFix =
        `${articleAfterAutoFix}\n<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>`
      mutationAttempts++
    }
  }

  // Final corruption scrub
  const beforeScrub = articleAfterAutoFix
  const scrubbed = scrubInsertionCorruption(articleAfterAutoFix)
  articleAfterAutoFix = scrubbed.html
  if (scrubbed.fixes > 0) mutationAttempts += scrubbed.fixes
  assertImageUrlsPreserved(beforeScrub, articleAfterAutoFix)
  assertImageUrlsPreserved(articleContent, articleAfterAutoFix)

  // ---- FINAL REVALIDATION on articleAfterAutoFix (Phase 9) ----
  // Rebuild issue list from the FINAL HTML for categories autofix can affect,
  // then confirm which pre-fix issues actually resolved.
  {
    let finalIssues: QualityIssue[] = []
    finalIssues = finalIssues.filter(() => false) // start clean from revalidation slices

    // Keep non-autofix-mutated categories from earlier scan when HTML body unchanged
    // for those rules — but always refresh autofix-touched categories from final HTML.
    const preserved = issues.filter(
      (i) =>
        i.category !== 'schema' &&
        i.category !== 'grant-figure' &&
        i.category !== 'claim-evidence' &&
        i.category !== 'hedging' &&
        i.category !== 'ai-slop' &&
        i.category !== 'cross-brand-link' &&
        i.id !== 'brand-mismatch' &&
        i.id !== 'schema-faq-parity',
    )

    finalIssues = [...preserved]
    finalIssues.push(...collectSchemaQualityIssues(articleAfterAutoFix, expectOrganizationLogo, primaryImageWidth))
    finalIssues.push(
      ...collectFactualClaimIssues(
        articleAfterAutoFix,
        freshnessCoveredFigureKeys(articleAfterAutoFix, datedPolicy?.now),
      ),
    )

    // Re-scan cross-brand <a> links on final HTML (canonical <link> never matched)
    {
      const linkPattern = /<a\s[^>]*href=["']https?:\/\/([^/"']+)/gi
      let linkMatch
      while ((linkMatch = linkPattern.exec(articleAfterAutoFix)) !== null) {
        const linkedDomain = linkMatch[1].replace('www.', '')
        const isBrandSite = ['autodun.com', 'seoranko.com', 'fitford.com', 'minso', 'minsofurniture'].some(
          (d) => linkedDomain.includes(d),
        )
        if (!isBrandSite) continue
        const isRegistered = registeredLinkDomains.some((d) => linkedDomain.includes(d))
        if (!isRegistered) {
          const context = articleAfterAutoFix.slice(
            Math.max(0, linkMatch.index - 30),
            linkMatch.index + 80,
          )
          finalIssues.push({
            id: `cross-brand-link-${finalIssues.length}`,
            severity: 'critical',
            category: 'cross-brand-link',
            title: `Cross-brand link detected: ${linkedDomain}`,
            description: `Article brand is "${brand}" but this links to "${linkedDomain}" which is not in the registry for this brand.`,
            location: context.slice(0, 100),
            autoFixable: false,
          })
        }
      }
    }

    // Re-scan AI slop on final HTML
    for (const pattern of AI_SLOP_PATTERNS) {
      const match = articleAfterAutoFix.match(pattern)
      if (match) {
        finalIssues.push({
          id: `slop-${finalIssues.length}`,
          severity: 'warning',
          category: 'ai-slop',
          title: `AI pattern detected: "${match[0]}"`,
          description: 'This phrase is a common AI-generated signal that reduces human score. Consider removing or rewriting.',
          location: match[0],
          autoFixable: false,
        })
      }
    }

    // Re-evaluate hedging on final HTML
    const hedgeFinal = evaluateHedging(articleAfterAutoFix)
    const realRepFinal = hedgeFinal.actionable.filter((a) => a.classification === 'REAL_REPETITION')
    if (realRepFinal.length >= 3 || ((hedgeFinal.byToken.typically || 0) >= 6 && hedgeFinal.autoFixableTokens.includes('typically'))) {
      finalIssues.push({
        id: 'hedging-real-repetition',
        severity: 'warning',
        category: 'hedging',
        title: `Repetitive hedge boilerplate detected (${realRepFinal.length || hedgeFinal.byToken.typically || 0}×)`,
        description: hedgeFinal.summary,
        autoFixable: false,
      })
    }
    if (isExtremeHedgeDensity(hedgeFinal)) {
      finalIssues.push({
        id: 'hedging-over',
        severity: 'warning',
        category: 'hedging',
        title: `Over-hedging — density ${hedgeFinal.densityPer100.toFixed(1)} per 100 words`,
        description: hedgeFinal.summary,
        autoFixable: false,
      })
    }
    const bm = detectWrongBrandInBody(articleAfterAutoFix, brand)
    if (bm) finalIssues.push(bm)

    finalIssues = consolidateDuplicateIssues(finalIssues)
    if (!skipLiveVerification) {
      finalIssues = await autoVerifyCitedPolicyIssues(finalIssues, datedPolicy?.now)
      // M07 — a logo URL being present in the schema is not the same as it
      // actually working (the Clearbit fallback this codebase used to emit
      // was dead for months and nothing caught it, because every prior
      // check only looked at field presence). A real HTTP request is the
      // only thing that can tell the difference.
      if (organizationLogoUrl) {
        const reachability = await verifyLogoUrlReachable(organizationLogoUrl)
        if (!reachability.reachable) {
          finalIssues.push({
            id: 'schema-Organization-logo-reachability',
            severity: 'critical',
            category: 'schema',
            title: 'Organization: logo URL does not resolve',
            description: `Organization.logo is set to "${organizationLogoUrl}" but a live check found it does not serve a valid image: ${reachability.reason}. Field presence alone does not mean the logo works — add a real logo in Brand Settings.`,
            autoFixable: false,
          })
        }
      }
    }
    finalIssues = withActionHints(finalIssues)

    const confirmation = confirmAutoFixOutcomes({
      beforeIssues: issuesBeforeAutoFix,
      afterIssues: finalIssues.map((i) => ({
        id: i.id,
        category: i.category,
        severity: i.severity,
        title: i.title,
      })),
      mutationAttempts,
      scoreBefore: scoreBeforeAutoFix,
      scoreAfter: scoreFromIssues(finalIssues),
    })

    const totals = recomputeQualityGateTotals({
      issues: finalIssues,
      autoFixedCount: confirmation.confirmedResolved.length,
      articleAfterAutoFix,
    })

    void logQualityGateRun(userId, articleId, finalIssues)
    void countTypically

    return {
      ...totals,
      autoFixConfirmation: confirmation,
    }
  }
}

/**
 * For grant-figure / dated-policy issues that already cite an official URL,
 * re-fetch the page and confirm the figure still appears. Auto-verified
 * items become severity `info` (or drop to PASS-equivalent advisory) so they
 * no longer block publish or inflate the Quality Gate warning count.
 *
 * Advisory/info grant figures with a citation are still eligible — live
 * verify upgrades "currentness recommended" → confirmed CURRENT.
 */
export async function autoVerifyCitedPolicyIssues(
  issues: QualityIssue[],
  now: Date = new Date(),
  fetchImpl?: typeof fetch,
): Promise<QualityIssue[]> {
  const out: QualityIssue[] = []
  for (const issue of issues) {
    const eligibleCategory =
      issue.category === 'grant-figure' ||
      issue.category === 'dated-policy' ||
      issue.category === 'claim-evidence'
    // Critical autofixable uncited figures have no URL — skip live verify.
    // Info advisories WITH a citation remain eligible for currentness confirm.
    const eligible =
      eligibleCategory &&
      !issue.autoFixable &&
      (issue.severity !== 'info' || Boolean(issue.citationUrl))

    if (!eligible) {
      out.push(issue)
      continue
    }

    // Critical uncited grant figures have no URL to check — keep them, but
    // still record the explicit no-citation reason for the action box.
    const figure =
      issue.figureText ||
      issue.description?.match(/Found:\s*"([^"]+)"/)?.[1] ||
      issue.title?.match(/"([^"]+)"/)?.[0]?.replace(/^"|"$/g, '') ||
      ''

    if (!issue.citationUrl) {
      // Only attach no-citation status when there is a concrete figure we
      // would have checked — stale-year / generic dated claims without a
      // figure stay as plain manual-review with an action hint.
      if (figure && /[£$€]\d|\d+%|up to/i.test(figure)) {
        out.push({
          ...issue,
          verificationStatus: 'no-citation',
          verificationDetail: 'no citation present to check',
        })
      } else {
        out.push(issue)
      }
      continue
    }

    if (!figure) {
      out.push({
        ...issue,
        citationUrl: issue.citationUrl,
        verificationStatus: 'no-citation',
        verificationDetail: 'no citation present to check',
      })
      continue
    }

    const label = sourceLabelForUrl(issue.citationUrl)
    const result = await verifyFigureAgainstCitation(figure, issue.citationUrl, {
      now,
      fetchImpl,
      sourceLabel: label,
    })

    if (result.status === 'auto-verified') {
      // Align with authoritative decision: SUPPORTED + live CURRENT → advisory only.
      const confirmed = decideClaimIssue({
        evidenceStatus: (issue.evidenceStatus as ClaimEvidenceStatus) || 'SUPPORTED',
        freshnessStatus: 'CURRENT',
        material: issue.category === 'grant-figure',
        figureText: figure,
        liveCurrentConfirmed: true,
      })
      out.push({
        ...issue,
        severity: confirmed.severity ?? 'info',
        title: `Auto-verified as of ${result.verifiedAsOf}: "${figure}"`,
        description: result.detail,
        explanation: confirmed.explanation,
        verificationStatus: 'auto-verified',
        verificationDetail: result.detail,
        evidenceStatus: confirmed.evidenceStatus,
        freshnessStatus: 'CURRENT',
        dimension: confirmed.dimension,
        affectsDimensions:
          confirmed.severity === null
            ? []
            : [confirmed.dimension, ...confirmed.alsoAffects],
        blocking: false,
        fixStatus: 'NO_FIX_NEEDED',
        remediation: undefined,
        autoFixable: false,
      })
    } else {
      // Live check failed — escalate soft advisories so the failure is visible.
      const escalatedSeverity =
        issue.severity === 'info' && result.status === 'figure-missing'
          ? 'warning'
          : issue.severity
      out.push({
        ...issue,
        severity: escalatedSeverity,
        verificationStatus: result.status,
        verificationDetail: result.detail,
        description: `${issue.description} — ${result.detail}.`,
        title:
          result.status === 'figure-missing'
            ? `Current claim could not be confirmed on source: "${figure}"`
            : issue.title,
        affectsDimensions:
          escalatedSeverity === 'warning' || escalatedSeverity === 'critical'
            ? ['factual_verification', 'freshness']
            : issue.affectsDimensions,
        fixStatus: 'MANUAL_REVIEW_REQUIRED',
        remediation: result.detail,
      })
    }
  }
  return out
}

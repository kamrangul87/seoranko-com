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
  detectDatedClaims,
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

// Grant-figure claims are evaluated separately by evaluateGrantFigureClaims()
// below — document-level claim-citation binding, not proximity matching.
// A fixed character window ("nearby") misses citations that appear earlier
// in the article, and matching only the word "verify" misses "confirm at
// GOV.UK" / "see GOV.UK" / etc. DANGEROUS_FACT_PATTERNS now only covers
// dated-policy claims, which don't need citation binding.
const DANGEROUS_FACT_PATTERNS = [
  {
    pattern: /\b(as of|from) (january|february|march|april|may|june|july|august|september|october|november|december) 20\d{2}\b.*?(grant|scheme|fund|subsid)/i,
    message: 'Dated grant/scheme claim — confirm this is still current policy',
    // Severity must match DATED_POLICY_SEVERITY — never diverge per pass.
    severity: DATED_POLICY_SEVERITY,
    category: 'dated-policy' as const,
  },
]

// A regulation's effective date ("enforced from June 2022") is a fixed
// historical fact — it doesn't go stale. What genuinely goes stale is a
// changeable FIGURE (a grant amount, rate, or cap) stated alongside a date.
// The pattern above matches on the word "grant"/"scheme" appearing anywhere
// in the sentence, which false-positives on claims that just reference
// eligibility for a grant without stating any amount that could change —
// e.g. "...doesn't qualify for the OZEV grant" has no £/% figure at all.
function hasChangeableFigureNearby(matchContext: string): boolean {
  return /[£$€]\s?\d|\d+\s?%/.test(matchContext)
}

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
  return INLINE_VERIFY_RE.test(localContext)
}

/**
 * Grant/financial figures — document-level claim-citation binding.
 *
 * Policy (GRANT_FIGURE_CITATION_POLICY = document-level-once):
 * one GOV.UK citation (or one verify hedge near any restatement) clears the
 * figure for the whole article. Repeated "up to £350" lines do not each need
 * their own nearby cite. Emit one issue per unique figure text.
 */
export function evaluateGrantFigureClaims(articleContent: string): QualityIssue[] {
  const issues: QualityIssue[] = []
  const citations = extractCitations(articleContent)
  const claims = extractFinancialClaims(articleContent)

  const byFigure = new Map<string, Claim[]>()
  for (const claim of claims) {
    const key = claim.text.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!byFigure.has(key)) byFigure.set(key, [])
    byFigure.get(key)!.push(claim)
  }

  for (const group of Array.from(byFigure.values())) {
    const unionTopics = new Set<string>()
    for (const c of group) {
      for (const t of Array.from(c.topicTerms)) unionTopics.add(t)
    }
    const representative: Claim = {
      text: group[0].text,
      position: group[0].position,
      topicTerms: unionTopics,
    }

    const anyInlineVerification = group.some(c =>
      claimHasInlineVerification(articleContent, c),
    )
    const boundCitation = findBoundCitation(representative, citations)
    const isBoundToCitation = !!boundCitation
    const isCited = anyInlineVerification || isBoundToCitation
    const count = group.length
    const countNote = count > 1 ? ` (appears ${count} times)` : ''
    const location = stripHtmlSnippet(
      articleContent.slice(
        Math.max(0, group[0].position - 40),
        Math.min(articleContent.length, group[0].position + 80),
      ),
    )

    issues.push({
      id: `fact-grant-figure-${group[0].position}`,
      severity: isCited ? 'warning' : 'critical',
      category: 'grant-figure',
      title: isCited
        ? 'Financial figure detected — properly sourced, just double-check it\'s current'
        : 'Specific monetary cap stated — verify this figure is current (grant amounts change frequently)',
      description: isCited
        ? `Found: "${group[0].text}"${countNote} — a citation to an official source exists in this article covering the same topic. One document-level citation covers every restatement; each instance does not need its own nearby cite. Confirm the figure is still accurate.`
        : `Found: "${group[0].text}"${countNote} — no citation to an official source found anywhere in the article on this topic. Add one GOV.UK link or "(verify at GOV.UK)" — a single document-level citation covers every restatement of this figure.`,
      location,
      citationUrl: boundCitation?.url,
      figureText: group[0].text,
      autoFixable: !isCited,
      autoFixDescription: !isCited
        ? 'Auto-fix adds "(verify at GOV.UK)" after each instance of this figure'
        : undefined,
    })
  }
  return issues
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
  return {
    id: `time-anchored-claim-${index}`,
    // FAIL-tier per the C04 spec — this codebase's 'critical' severity
    // (blocks quality_passed), matching evaluateGrantFigureClaims'
    // treatment of an uncited financial figure.
    severity: 'critical',
    category: 'dated-policy',
    title: `Time-anchored claim — confirm still current: "${claim.extractedNumericValue || claim.matchedPattern}"`,
    description: `"${claim.sentence}" — ${reasons.join('; ')}. Re-check by ${claim.reviewBy}.`,
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
 * Chrono dated-claims + stale-year findings, always at DATED_POLICY_SEVERITY.
 * Shared by article-v2 / recheck / Fix All via runQualityGate — never build
 * these issues in a caller with a different severity.
 */
export function buildDatedPolicyIssues(
  articleContent: string,
  opts?: {
    now?: Date
    title?: string
    metaDescription?: string
  },
): QualityIssue[] {
  const now = opts?.now ?? new Date()
  const issues: QualityIssue[] = []
  // Populated by the chrono dated-claims pass below, read by the
  // time-anchored-claims pass further down so the two detectors (which
  // overlap on date-bearing sentences like "as of August 2026") don't both
  // emit an issue for the exact same sentence.
  const sentencesAlreadyFlagged = new Set<string>()

  try {
    const datedClaims = detectDatedClaims(articleContent, now)
    const unsourced = datedClaims.filter(c => !c.hasSource)
    const uniqueUnsourced = Array.from(
      new Map(unsourced.map(c => [c.sentence.trim(), c])).values(),
    )
    for (const claim of uniqueUnsourced) sentencesAlreadyFlagged.add(claim.sentence.trim())
    for (let i = 0; i < uniqueUnsourced.length; i++) {
      const claim = uniqueUnsourced[i]
      issues.push({
        id: `dated-claim-${i}`,
        severity: DATED_POLICY_SEVERITY,
        category: 'dated-policy',
        title: `Dated claim — confirm still current: "${claim.text}"`,
        description: `"${claim.sentence}" — tied to a date but no named source or link found nearby. Add a GOV.UK citation or verify the figure is still accurate. Re-check by ${claim.reviewBy.slice(0, 10)}.`,
        location: claim.sentence.slice(0, 100),
        autoFixable: false,
      })
    }
  } catch (err) {
    console.warn('[article-quality-gate] dated-claim detection failed:', err)
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

  try {
    // Broader than detectDatedClaims: catches relative claims with no
    // parseable date token at all ("currently, the grant covers 75%").
    // Skip any sentence the chrono pass above already flagged — both
    // detectors legitimately fire on genuine date-token sentences like
    // "as of August 2026", and a sentence shouldn't get two issues for the
    // same underlying defect.
    const timeAnchoredClaims = detectTimeAnchoredClaims(articleContent, now)
      .filter(c => !sentencesAlreadyFlagged.has(c.sentence.trim()))
    const uniqueTimeAnchoredClaims = Array.from(
      new Map(timeAnchoredClaims.map(c => [c.sentence.trim(), c])).values(),
    )
    const failures = validateTimeAnchoredClaims(articleContent, uniqueTimeAnchoredClaims)
    for (let i = 0; i < failures.length; i++) {
      issues.push(timeAnchoredClaimFailureToIssue(failures[i], i, articleContent))
    }
  } catch (err) {
    console.warn('[article-quality-gate] time-anchored-claim detection failed:', err)
  }

  return issues
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

function countHedgeWords(content: string): Record<string, number> {
  const hedges = ['typically', 'generally', 'usually', 'often', 'sometimes', 'may', 'might', 'could', 'tend to']
  const counts: Record<string, number> = {}
  for (const hedge of hedges) {
    const matches = content.match(new RegExp(`\\b${hedge}\\b`, 'gi')) || []
    if (matches.length > 0) counts[hedge] = matches.length
  }
  return counts
}

// ============================================================
// QUALITY ISSUE TYPES
// ============================================================

export type IssueSeverity = 'critical' | 'warning' | 'info'
export type IssueCategory =
  | 'typo'
  | 'merge-artifact'
  | 'grant-figure'
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
}

export interface QualityGateResult {
  passed: boolean
  score: number
  issues: QualityIssue[]
  criticalCount: number
  warningCount: number
  autoFixedCount: number
  articleAfterAutoFix: string
  readyToPublish: boolean
  blockers: string[]
}

/** Recompute score/counts/ready from the current issues list (single source of truth). */
export function recomputeQualityGateTotals(
  gate: Pick<QualityGateResult, 'issues' | 'autoFixedCount' | 'articleAfterAutoFix'> &
    Partial<Pick<QualityGateResult, 'passed' | 'score' | 'criticalCount' | 'warningCount' | 'readyToPublish' | 'blockers'>>,
): QualityGateResult {
  const issues = gate.issues
  const criticalCount = issues.filter(i => i.severity === 'critical').length
  const warningCount = issues.filter(i => i.severity === 'warning').length
  const score = Math.max(0, 100 - (criticalCount * 20) - (warningCount * 5))
  const passed = criticalCount === 0
  const missingBrand = issues.some(i => i.id === 'missing-brand')
  const brandMismatch = issues.some(i => i.id === 'brand-mismatch')
  const scoreFloorFail = issues.some(i => i.category === 'score-floor' && i.severity === 'critical')
  const readyToPublish =
    criticalCount === 0 &&
    warningCount <= 2 &&
    !missingBrand &&
    !brandMismatch &&
    !scoreFloorFail
  const blockers = issues
    .filter(i =>
      i.severity === 'critical' ||
      i.id === 'missing-brand' ||
      i.id === 'brand-mismatch' ||
      i.category === 'score-floor'
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
export function collectSchemaQualityIssues(
  html: string,
  expectOrganizationLogo?: boolean,
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

  // Keyword density / presence floor
  const densityMissing =
    (typeof keywordDensityPct === 'number' && keywordDensityPct < 0.15) ||
    (typeof keywordDensityScore === 'number' && keywordDensityScore < 20)
  if (densityMissing) {
    out.push({
      id: 'score-floor-keyword-density',
      severity: 'critical',
      category: 'score-floor',
      title: `Keyword density too low for "${keyword}" (${keywordDensityPct?.toFixed(1) ?? '0.0'}% / score ${keywordDensityScore ?? 0})`,
      description: 'The primary keyword barely appears in the body. An article must not show Ready to publish with near-zero keyword presence.',
      autoFixable: true,
      autoFixDescription: 'Run Fix All / Improve keyword density',
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
    }
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
    }
  }

  let issues: QualityIssue[] = extraIssues ? [...extraIssues] : []
  let articleAfterAutoFix = articleContent
  let autoFixedCount = 0

  // Dated-policy is owned by the gate (same severity on every pass). Drop any
  // caller-supplied dated-policy extras so article-v2 cannot diverge from
  // recheck / Fix All.
  issues = issues.filter(i => i.category !== 'dated-policy')
  issues.push(...buildDatedPolicyIssues(articleContent, datedPolicy))

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

  // ---- RULE 2: Dangerous fact patterns (dated-policy only — grant figures
  // are evaluated separately below via document-level claim-citation binding) ----
  for (const rule of DANGEROUS_FACT_PATTERNS) {
    const match = articleContent.match(rule.pattern)
    if (match) {
      const idx = articleContent.search(rule.pattern)
      const context = articleContent.slice(Math.max(0, idx - 20), idx + 80)
      if (!hasChangeableFigureNearby(context)) continue // fixed regulatory date, not a changeable claim
      const figureMatch = context.match(/[£$€]\s?\d[\d,]*(?:\.\d+)?|\d+\s?%/)
      const claimLike: Claim = {
        text: figureMatch?.[0] || match[0],
        position: idx,
        topicTerms: extractTopicTerms(context),
      }
      const bound = findBoundCitation(claimLike, extractCitations(articleContent))
      issues.push({
        id: `fact-${rule.category}-${issues.length}`,
        severity: rule.severity,
        category: rule.category,
        title: rule.message,
        description: `Found: "${match[0]}" — Double-check this claim.`,
        location: context.trim().slice(0, 100),
        figureText: figureMatch?.[0],
        citationUrl: bound?.url,
        autoFixable: false,
      })
    }
  }

  // ---- RULE 2b: Grant-figure claims — document-level claim-citation binding ----
  issues.push(...evaluateGrantFigureClaims(articleContent))

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

  // ---- RULE 4: "Typically" overuse ----
  const typicallyCount = countTypically(articleContent)
  if (typicallyCount > maxTypically) {
    issues.push({
      id: 'hedging-typically',
      severity: typicallyCount > 10 ? 'critical' : 'warning',
      category: 'hedging',
      title: `"Typically" used ${typicallyCount} times — target is ${maxTypically} or fewer`,
      description: `High frequency hedging (${typicallyCount}×) is a primary AI-detection signal. The humaniser should reduce this but ${typicallyCount} instances remain.`,
      autoFixable: true,
      autoFixDescription: `Auto-fix reduces "typically" count to ${maxTypically} by replacing excess instances`
    })
  }

  const hedgeCounts = countHedgeWords(articleContent)
  const totalHedges = Object.values(hedgeCounts).reduce((a, b) => a + b, 0)
  const wordCount = countArticleWords(articleContent)

  if (totalHedges > wordCount / 50) {
    issues.push({
      id: 'hedging-total',
      severity: 'warning',
      category: 'hedging',
      title: `High hedge word density: ${totalHedges} hedge words in ${wordCount} words`,
      description: `Top offenders: ${Object.entries(hedgeCounts).sort((a,b) => b[1]-a[1]).slice(0,3).map(([w,c]) => `"${w}" ×${c}`).join(', ')}`,
      autoFixable: false
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
  issues.push(...collectSchemaQualityIssues(articleContent, expectOrganizationLogo))

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

  // ---- RULE 8: Word count ----
  if (wordCount < minWordCount) {
    issues.push({
      id: 'word-count-low',
      severity: 'warning',
      category: 'word-count',
      title: `Article is ${wordCount} words — below target minimum of ${minWordCount}`,
      description: 'Article is shorter than the soft minimum for the selected length target (±12% band).',
      autoFixable: false
    })
  }
  if (maxWordCount != null && wordCount > maxWordCount) {
    issues.push({
      id: 'word-count-high',
      severity: 'warning',
      category: 'word-count',
      title: `Article is ${wordCount} words — exceeds target maximum of ${maxWordCount}`,
      description: 'Article is longer than the soft maximum for the selected length target (±12% band).',
      autoFixable: false
    })
  }

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
        autoFixedCount += fixed.appliedCount
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
      autoFixedCount += introFix.appliedCount
    }
    // Re-check — clear brand-mismatch if resolved
    if (!detectWrongBrandInBody(articleAfterAutoFix, brand)) {
      issues = issues.filter(i => i.id !== 'brand-mismatch')
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
    autoFixedCount += linkFix.appliedCount
  }

  // Fix 2: Reduce "typically" overuse — text nodes only (never attributes/JSON-LD)
  const typIssue = issues.find(i => i.id === 'hedging-typically' && i.autoFixable)
  if (typIssue) {
    let count = 0
    articleAfterAutoFix = transformHtmlTextNodes(articleAfterAutoFix, (text) => {
      const typFix = applyGuardedRegexReplace(
        text,
        /\btypically\b/gi,
        (match) => {
          count++
          if (count > maxTypically) return ''
          return match
        },
        'typically-reduce',
      )
      autoFixedCount += typFix.appliedCount
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
        autoFixedCount += slopFix.appliedCount
        return slopFix.html
      })
    }
  }

  // Fix 4: Grant-figure hedges — add "(verify at GOV.UK)" next to unsourced caps
  // Guarded: never accept a splice that leaves ".350." or splits the sentence.
  if (issues.some(i => i.category === 'grant-figure' && i.autoFixable)) {
    articleAfterAutoFix = transformHtmlTextNodes(articleAfterAutoFix, (text) => {
      const grantFix = applyGuardedRegexReplace(
        text,
        /\bup to (\d+%|£\d+)\b(?!\s*\(verify at GOV\.UK\))/gi,
        (match) => `${match} (verify at GOV.UK)`,
        'grant-figure-verify',
      )
      autoFixedCount += grantFix.appliedCount
      return grantFix.html
    })
    // Re-evaluate — clear criticals that are now hedged
    const remainingGrant = evaluateGrantFigureClaims(articleAfterAutoFix)
    const stillCritical = new Set(
      remainingGrant.filter(i => i.severity === 'critical').map(i => i.id)
    )
    issues = issues.filter(i => {
      if (i.category !== 'grant-figure') return true
      return stillCritical.has(i.id)
    })
    const clearedGrant = !remainingGrant.some(i => i.severity === 'critical')
    if (clearedGrant) {
      issues = issues.filter(i => i.category !== 'grant-figure')
    } else {
      issues = [
        ...issues.filter(i => i.category !== 'grant-figure'),
        ...remainingGrant.filter(i => i.severity === 'critical'),
      ]
    }
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
      autoFixedCount++
      issues = issues.filter(i => i.id !== 'schema-faq-parity')
    }
  }

  // Do NOT collapse whitespace across the whole HTML document — that would
  // rewrite attribute values and JSON-LD. Prose double-spaces are already
  // normalised inside the text-node autofixes above.

  // Final corruption scrub — catches any residual ".350." / similar shapes
  // (text-node scoped; asserts image URLs unchanged)
  const beforeScrub = articleAfterAutoFix
  const scrubbed = scrubInsertionCorruption(articleAfterAutoFix)
  articleAfterAutoFix = scrubbed.html
  if (scrubbed.fixes > 0) autoFixedCount += scrubbed.fixes
  assertImageUrlsPreserved(beforeScrub, articleAfterAutoFix)
  assertImageUrlsPreserved(articleContent, articleAfterAutoFix)

  // The "typically" auto-fix above already runs automatically and silently
  // reduces the count in articleAfterAutoFix — but issues/score were computed
  // against the PRE-fix article and never recomputed, so the returned result
  // still showed "7 instances, unresolved" even when the published text had
  // already been corrected to 5. Re-check against the actual fixed text.
  if (typIssue) {
    const remainingCount = countTypically(articleAfterAutoFix)
    if (remainingCount <= maxTypically) {
      issues = issues.filter(i => i.id !== 'hedging-typically')
    } else {
      const stillFlagged = issues.find(i => i.id === 'hedging-typically')
      if (stillFlagged) {
        stillFlagged.title = `"Typically" auto-fixed to ${remainingCount} (target ${maxTypically}) — still above target`
        stillFlagged.description = `Auto-fix already ran and reduced this from the original count, but ${remainingCount} instances remain above the ${maxTypically} target.`
      }
    }
  }

  // Schema issues must describe articleAfterAutoFix — FAQPage inject (and any
  // future schema-touching autofix) mutates JSON-LD after the initial RULE 6
  // pass. Refresh so score / issues / readyToPublish match the returned HTML
  // (final-artifact invariant for the gate itself).
  issues = [
    ...issues.filter(i => i.category !== 'schema'),
    ...collectSchemaQualityIssues(articleAfterAutoFix, expectOrganizationLogo),
  ]

  // The same fact (e.g. a grant figure) can legitimately be restated several
  // times across an article — each restatement earns its own issue from the
  // rules above, but showing 5 identical cards is a display problem, not 5
  // separate defects. Consolidate before scoring so one real issue doesn't
  // cost 5x the score penalty or produce 5 rows in the recurring-issue log.
  issues = consolidateDuplicateIssues(issues)

  // Auto-verify cited grant/dated-policy figures against the live official page.
  // Matching → info ("auto-verified as of …"); failures stay flagged with a
  // specific reason (missing figure / unreachable / no citation).
  issues = await autoVerifyCitedPolicyIssues(issues, datedPolicy?.now)

  issues = withActionHints(issues)

  // ---- COMPUTE FINAL SCORE (single source of truth) ----
  const totals = recomputeQualityGateTotals({
    issues,
    autoFixedCount,
    articleAfterAutoFix,
  })

  void logQualityGateRun(userId, articleId, issues)

  return totals
}

/**
 * For grant-figure / dated-policy issues that already cite an official URL,
 * re-fetch the page and confirm the figure still appears. Auto-verified
 * items become severity `info` so they no longer block publish or inflate
 * the Quality Gate warning count.
 */
export async function autoVerifyCitedPolicyIssues(
  issues: QualityIssue[],
  now: Date = new Date(),
  fetchImpl?: typeof fetch,
): Promise<QualityIssue[]> {
  const out: QualityIssue[] = []
  for (const issue of issues) {
    const eligible =
      (issue.category === 'grant-figure' || issue.category === 'dated-policy') &&
      issue.severity !== 'info' &&
      !issue.autoFixable

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
      out.push({
        ...issue,
        severity: 'info',
        title: `Auto-verified as of ${result.verifiedAsOf}: "${figure}"`,
        description: result.detail,
        verificationStatus: 'auto-verified',
        verificationDetail: result.detail,
        autoFixable: false,
      })
    } else {
      out.push({
        ...issue,
        verificationStatus: result.status,
        verificationDetail: result.detail,
        description: `${issue.description} — ${result.detail}.`,
      })
    }
  }
  return out
}

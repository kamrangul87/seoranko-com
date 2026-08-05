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
    severity: 'warning' as const,
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
function isClaimBoundToCitation(claim: Claim, allCitations: Citation[]): boolean {
  for (const citation of allCitations) {
    const sharedTerms = Array.from(claim.topicTerms).filter(t => citation.topicTerms.has(t))
    // Require at least 2 shared meaningful topic words (e.g. "ozev", "grant",
    // "charger") between the claim's context and a citation's context anywhere
    // in the document — this is the claim-to-citation binding
    if (sharedTerms.length >= 2) return true
  }
  return false
}

function evaluateGrantFigureClaims(articleContent: string): QualityIssue[] {
  const issues: QualityIssue[] = []
  const citations = extractCitations(articleContent)
  const claims = extractFinancialClaims(articleContent)

  for (const claim of claims) {
    const localContext = articleContent.slice(
      Math.max(0, claim.position - 150),
      Math.min(articleContent.length, claim.position + 150)
    )
    const hasInlineVerification = /\b(verify|confirm|check|see|refer to)\b.{0,40}\b(gov\.uk|government|official)/i.test(localContext)
    const isBoundToCitation = isClaimBoundToCitation(claim, citations)

    const isCited = hasInlineVerification || isBoundToCitation

    issues.push({
      id: `fact-grant-figure-${claim.position}`,
      severity: isCited ? 'warning' : 'critical',
      category: 'grant-figure',
      title: isCited
        ? 'Financial figure detected — properly sourced, just double-check it\'s current'
        : 'Specific monetary cap stated — verify this figure is current (grant amounts change frequently)',
      description: isCited
        ? `Found: "${claim.text}" — a citation to an official source exists in this article covering the same topic. Good practice, just confirm the figure is still accurate.`
        : `Found: "${claim.text}" — no citation to an official source found anywhere in the article on this topic. Add a GOV.UK link or "(verify at GOV.UK)" next to this figure.`,
      autoFixable: !isCited,
      autoFixDescription: !isCited ? 'Auto-fix adds "(verify at GOV.UK)" after the figure' : undefined
    })
  }
  return issues
}

const COPY_ERROR_PATTERNS = [
  {
    pattern: /\b(\w{2,})\s+\1\b/g,
    message: 'Duplicate word found',
    severity: 'critical' as const,
    category: 'typo' as const,
  },
  {
    pattern: /[a-z]\.[a-z]/g,
    message: 'Possible missing space after period',
    severity: 'warning' as const,
    category: 'typo' as const,
  },
  {
    pattern: /\b\w*([a-z])\1{3,}\w*\b/g,
    message: 'Possible repeated character / typo',
    severity: 'warning' as const,
    category: 'typo' as const,
  },
  {
    pattern: /\.\s*[a-z]{1,4}\.\s+[A-Z]/g,
    message: 'Possible broken paragraph merge — short fragment between sentences',
    severity: 'critical' as const,
    category: 'merge-artifact' as const,
  },
  {
    pattern: /\b[a-z]{2,6}\.\s?[a-z]\s[a-z]{2,}/g,
    message: 'Likely truncated word or merged sentence — a word appears to be cut off mid-way',
    severity: 'critical' as const,
    category: 'merge-artifact' as const,
  },
]

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
  | 'schema'
  | 'missing-author'
  | 'missing-date'
  | 'word-count'
  | 'fact-density'
  | 'image-completeness'
  | 'heading-hierarchy'
  | 'image-placement'
  | 'scannability'
  | 'heading-rhythm'

export interface QualityIssue {
  id: string
  severity: IssueSeverity
  category: IssueCategory
  title: string
  description: string
  location?: string
  autoFixable: boolean
  autoFixDescription?: string
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
    maxTypically?: number
    userId?: string
    articleId?: string
    expectedImageCount?: number
  }
): Promise<QualityGateResult> {

  const {
    brand,
    authorName,
    registeredLinkDomains,
    minWordCount = 800,
    maxTypically = 5,
    userId,
    articleId,
    expectedImageCount,
  } = options

  let issues: QualityIssue[] = []
  let articleAfterAutoFix = articleContent
  let autoFixedCount = 0

  // ---- RULE 1: Typos and copy errors ----
  // Checked against visible text only (see stripHtmlForTextChecks) so these
  // never false-positive on markup or attribute values like style="...8px 8px...".
  const textForCopyChecks = stripHtmlForTextChecks(articleContent)
  for (const rule of COPY_ERROR_PATTERNS) {
    const matches = textForCopyChecks.match(rule.pattern)
    if (matches && matches.length > 0) {
      const idx = textForCopyChecks.search(rule.pattern)
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

  // ---- RULE 2: Dangerous fact patterns (dated-policy only — grant figures
  // are evaluated separately below via document-level claim-citation binding) ----
  for (const rule of DANGEROUS_FACT_PATTERNS) {
    const match = articleContent.match(rule.pattern)
    if (match) {
      const idx = articleContent.search(rule.pattern)
      const context = articleContent.slice(Math.max(0, idx - 20), idx + 80)
      if (!hasChangeableFigureNearby(context)) continue // fixed regulatory date, not a changeable claim
      issues.push({
        id: `fact-${rule.category}-${issues.length}`,
        severity: rule.severity,
        category: rule.category,
        title: rule.message,
        description: `Found: "${match[0]}" — Double-check this claim.`,
        location: context.trim().slice(0, 100),
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
  const wordCount = articleContent.split(/\s+/).filter(w => w.length > 0).length

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
  const linkPattern = /href=["']https?:\/\/([^/"']+)/gi
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
  const schemaResult = validateSchema(articleContent)

  for (const schemaIssue of schemaResult.issues) {
    issues.push({
      id: `schema-${schemaIssue.schemaType}-${schemaIssue.property}`,
      severity: schemaIssue.severity === 'error' ? 'critical' : 'warning',
      category: 'schema',
      title: `${schemaIssue.schemaType}: ${schemaIssue.property}`,
      description: schemaIssue.message,
      autoFixable: false
    })
  }

  // Schema/content parity — a visible FAQ with no FAQPage block. This is a
  // cross-check against the rendered article, not a JSON-LD property rule,
  // so it stays outside validateSchema().
  const hasVisibleFAQ = /<h3>/.test(articleContent) || /class="faq/.test(articleContent)
  if (hasVisibleFAQ && !schemaResult.schemasFound.includes('FAQPage')) {
    issues.push({
      id: 'schema-faq-parity',
      severity: 'critical',
      category: 'schema',
      title: 'FAQPage schema missing but FAQ content exists',
      description: 'Visible FAQ section found but no FAQPage JSON-LD schema. Schema must match visible content.',
      autoFixable: false
    })
  }

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

  // ---- RULE 8: Word count ----
  if (wordCount < minWordCount) {
    issues.push({
      id: 'word-count',
      severity: 'warning',
      category: 'word-count',
      title: `Article is ${wordCount} words — minimum recommended is ${minWordCount}`,
      description: 'Short articles rank below the recommended threshold for comprehensive topic coverage.',
      autoFixable: false
    })
  }

  // ---- RULE 9: Image completeness — every provider in the image chain failed for at least one slot ----
  if (expectedImageCount != null) {
    issues.push(...checkImageCompleteness(articleContent, expectedImageCount))
  }

  // ---- RULE 10: Article structure — heading hierarchy, scannability, heading rhythm ----
  // image-placement is deliberately NOT expected to fire from this call: images
  // haven't been injected into articleContent yet at this point in the pipeline
  // (same timing as RULE 9 — see article-v2/route.ts, which runs a second,
  // targeted validateArticleStructure() call against the post-injection HTML
  // specifically for that category).
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

  // ---- AUTO-FIX PASS ----
  // Fix 1: Remove cross-brand links
  if (issues.some(i => i.category === 'cross-brand-link' && i.autoFixable)) {
    articleAfterAutoFix = articleAfterAutoFix.replace(
      /<a[^>]*href=["'][^"']*["'][^>]*>([^<]*)<\/a>/gi,
      (match, anchorText) => {
        const hrefMatch = match.match(/href=["']https?:\/\/([^/"']+)/)
        if (!hrefMatch) return match
        const domain = hrefMatch[1].replace('www.', '')
        const isWrongBrand = ['autodun.com', 'seoranko.com', 'fitford.com'].some(d =>
          domain.includes(d) && !registeredLinkDomains.some(r => domain.includes(r))
        )
        if (isWrongBrand) { autoFixedCount++; return anchorText }
        return match
      }
    )
  }

  // Fix 2: Reduce "typically" overuse
  const typIssue = issues.find(i => i.id === 'hedging-typically' && i.autoFixable)
  if (typIssue) {
    let count = 0
    articleAfterAutoFix = articleAfterAutoFix.replace(/\btypically\b/gi, (match) => {
      count++
      if (count > maxTypically) { autoFixedCount++; return '' }
      return match
    })
    articleAfterAutoFix = articleAfterAutoFix.replace(/\s{2,}/g, ' ')
  }

  // Fix 3: Remove auto-fixable AI slop patterns
  for (const pattern of AI_SLOP_PATTERNS) {
    const slopIssue = issues.find(
      i => i.category === 'ai-slop' && i.autoFixable &&
      i.location && pattern.test(i.location)
    )
    if (slopIssue) {
      articleAfterAutoFix = articleAfterAutoFix.replace(pattern, '')
      autoFixedCount++
    }
  }

  articleAfterAutoFix = articleAfterAutoFix.replace(/\s{2,}/g, ' ').trim()

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

  // The same fact (e.g. a grant figure) can legitimately be restated several
  // times across an article — each restatement earns its own issue from the
  // rules above, but showing 5 identical cards is a display problem, not 5
  // separate defects. Consolidate before scoring so one real issue doesn't
  // cost 5x the score penalty or produce 5 rows in the recurring-issue log.
  issues = consolidateDuplicateIssues(issues)

  // ---- COMPUTE FINAL SCORE ----
  const criticalCount = issues.filter(i => i.severity === 'critical').length
  const warningCount = issues.filter(i => i.severity === 'warning').length
  const score = Math.max(0, 100 - (criticalCount * 20) - (warningCount * 5))
  const passed = criticalCount === 0
  const readyToPublish = criticalCount === 0 && warningCount <= 2
  const blockers = issues
    .filter(i => i.severity === 'critical')
    .map(i => `[${i.category.toUpperCase()}] ${i.title}`)

  void logQualityGateRun(userId, articleId, issues)

  return { passed, score, issues, criticalCount, warningCount, autoFixedCount, articleAfterAutoFix, readyToPublish, blockers }
}

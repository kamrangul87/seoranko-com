/**
 * Claim-level evidence model (Phase 5).
 *
 * One document-level citation is NOT proof of every claim in the article.
 * The same claim restated without repeating the link is fine — we bind once
 * per claim identity (typically unique figure + claim type).
 *
 * Statuses are the product-facing claim state. Time framing and evidence
 * quality both feed into `status` via `deriveClaimEvidenceStatus`.
 */

export type ClaimEvidenceStatus =
  | 'SUPPORTED'
  | 'PARTIALLY_SUPPORTED'
  | 'UNSUPPORTED'
  | 'OUTDATED'
  | 'HISTORICAL'
  | 'CONTRADICTED'
  | 'NEEDS_REVIEW'

export type ClaimSourceAuthority = 'official' | 'secondary' | 'unknown'

export type ClaimEvidenceKind =
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

export interface ClaimSourceRef {
  url: string
  authority: ClaimSourceAuthority
  /** ISO date or human-readable "last updated" when known. */
  sourceDate?: string | null
  /** Snippet from the article near the citation, or fetched page excerpt. */
  supportingPassage?: string | null
}

/**
 * Canonical claim evidence record.
 *
 * Claim → source → source date → source authority → supporting passage → status
 */
export interface ClaimEvidence {
  /** Stable id for dedupe (figure + kind + normalized claim core). */
  claimId: string
  claimText: string
  claimKind: ClaimEvidenceKind
  figureText?: string
  /** How many times this claim identity appears in the article. */
  occurrenceCount: number
  source: ClaimSourceRef | null
  status: ClaimEvidenceStatus
  /** Why this status was chosen (for Quality Gate descriptions). */
  rationale: string
  recommendedAction: string
}

export interface ArticleCitation {
  url: string
  anchorText: string
  position: number
  /** Plain-text window around the link in the article. */
  contextText: string
  topicTerms: Set<string>
}

export interface ExtractedFactualClaim {
  text: string
  position: number
  figureText?: string
  claimKind: ClaimEvidenceKind
  topicTerms: Set<string>
  /** Full sentence / local window for display. */
  claimText: string
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'will',
  'into', 'your', 'their', 'than', 'then', 'also', 'over', 'under', 'about',
  'when', 'where', 'which', 'while', 'been', 'been', 'were', 'been', 'been',
  'eligible', 'applicants', 'costs', 'toward', 'towards', 'installation',
])

const OFFICIAL_HOST_RE =
  /\.(gov\.uk|legislation\.gov\.uk|ofgem\.gov\.uk)|europa\.eu|nist\.gov|who\.int|irs\.gov/i

const FIGURE_RE =
  /(?:up to\s+)?(?:[£$€]\s?[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s?%)/gi

const QUANT_CLAIM_RE =
  /[£$€]\s?\d|\d+\s?%|\b(grant|scheme|fund(?:ing)?|subsid(?:y|ies)|rebate|allowance|rate|tariff|threshold|cap|eligib|tax|duty|levy|standard|regulation|policy)\b/i

export function isOfficialClaimUrl(url: string): boolean {
  try {
    return OFFICIAL_HOST_RE.test(new URL(url).hostname) || OFFICIAL_HOST_RE.test(url)
  } catch {
    return OFFICIAL_HOST_RE.test(url)
  }
}

export function sourceAuthorityForUrl(url: string): ClaimSourceAuthority {
  if (isOfficialClaimUrl(url)) return 'official'
  if (/^\s*https?:\/\//i.test(url)) return 'secondary'
  return 'unknown'
}

export function extractTopicTerms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, ' ')
      .replace(/[^a-z0-9\s£$€%]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
  )
}

function normalizeFigure(figure: string): string {
  return figure.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Canonical figure identity: "up to £1,200" === "£1200".
 * Used for grouping restatements and complementary grant/claim-evidence skip.
 */
export function normalizeClaimFigureIdentity(figure: string): string {
  return normalizeFigure(figure)
    .replace(/^up to\s+/i, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
}

const MATERIAL_POLICY_KINDS = new Set<ClaimEvidenceKind>([
  'grant',
  'eligibility',
  'government-policy',
  'regulation',
  'tax-legal',
])

export function isMaterialPolicyClaimKind(kind: ClaimEvidenceKind): boolean {
  return MATERIAL_POLICY_KINDS.has(kind)
}

/**
 * Grant-figure Quality Gate path owns material policy/grant figures only.
 * Survey percentages and hardware price bands belong to claim-evidence.
 */
export function isGrantFigureOwnedClaim(ev: {
  figureText?: string
  claimKind: ClaimEvidenceKind
}): boolean {
  if (!ev.figureText) return false
  if (!/[£$€%]/.test(ev.figureText) && !/up to/i.test(ev.figureText)) return false
  return isMaterialPolicyClaimKind(ev.claimKind)
}

/**
 * Visible article body only — never <head>, JSON-LD, scripts, styles, or attributes.
 */
export function articleVisibleHtml(html: string): string {
  const withoutChrome = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  const article = withoutChrome.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
  if (article) return article[1]
  const main = withoutChrome.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)
  if (main) return main[1]
  const body = withoutChrome.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
  if (body) return body[1]
  return withoutChrome
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sentencesFromPlain(plain: string): string[] {
  return plain
    .split(/(?<=[.!?])\s+(?=[A-Z"'£$€(0-9])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function classifyClaimKind(text: string): ClaimEvidenceKind {
  if (/\bgrant|rebate|subsid/i.test(text)) return 'grant'
  if (/\beligib/i.test(text)) return 'eligibility'
  if (/\b(tax|duty|levy|hmrc)\b/i.test(text)) return 'tax-legal'
  if (/\b(regulation|regulated|statutory|legislation)\b/i.test(text)) return 'regulation'
  if (/\b(policy|scheme|fund)\b/i.test(text)) return 'government-policy'
  if (/\b(price|cost|£|\$|€)\b/i.test(text)) return 'price'
  if (/\d+\s?%/.test(text) || /\b(statistic|average|rate)\b/i.test(text)) return 'statistic'
  if (/\b(standard|BS\s?\d|IEC)\b/i.test(text)) return 'technical-standard'
  if (/\b(available|availability|offer(?:ed|ing)?)\b/i.test(text)) return 'service-availability'
  if (/\b(deadline|by\s+(?:19|20)\d{2})\b/i.test(text)) return 'deadline'
  return 'other-quantitative'
}

export function claimIdentityKey(claim: Pick<ExtractedFactualClaim, 'figureText' | 'claimKind' | 'claimText'>): string {
  // Same figure = same claim identity regardless of grant vs eligibility wording.
  // Do not require a repeated citation after every restatement.
  if (claim.figureText) {
    return `figure::${normalizeClaimFigureIdentity(claim.figureText)}`
  }
  const core = claim.claimText
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9%£$€ ]/g, '')
    .slice(0, 80)
  return `${claim.claimKind}::${core}`
}

/** Extract authoritative citations with local article context. */
export function extractArticleCitations(articleHtml: string): ArticleCitation[] {
  const citations: ArticleCitation[] = []
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(articleHtml)) !== null) {
    const url = match[1]
    if (!/^https?:\/\//i.test(url)) continue

    // Prefer the enclosing <p> as the supporting passage — a citation in
    // paragraph A must not "figure-support" a claim that only appears in
    // paragraph B just because the article is short.
    const paraStart = articleHtml.lastIndexOf('<p', match.index)
    const paraEnd = articleHtml.indexOf('</p>', match.index)
    let contextText: string
    if (paraStart !== -1 && paraEnd !== -1 && paraEnd > match.index) {
      const paraHtml = articleHtml.slice(paraStart, paraEnd + 4)
      contextText = stripHtml(paraHtml)
    } else {
      const tightStart = Math.max(0, match.index - 120)
      const tightEnd = Math.min(articleHtml.length, match.index + match[0].length + 120)
      contextText = stripHtml(articleHtml.slice(tightStart, tightEnd))
    }

    citations.push({
      url,
      anchorText: stripHtml(match[2]),
      position: match.index,
      contextText,
      // Topic terms from the citation's own paragraph only — do not bleed
      // neighboring paragraphs into support for unrelated claims.
      topicTerms: extractTopicTerms(contextText),
    })
  }
  return citations
}

/**
 * Important factual claims: quantitative / policy assertions with a figure
 * or strong policy machinery — not every sentence.
 */
export function extractImportantFactualClaims(articleHtml: string): ExtractedFactualClaim[] {
  const claims: ExtractedFactualClaim[] = []
  const scoped = articleVisibleHtml(articleHtml)
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let pm: RegExpExecArray | null
  while ((pm = pRe.exec(scoped)) !== null) {
    const inner = pm[1]
    const plain = stripHtml(inner)
    if (!QUANT_CLAIM_RE.test(plain)) continue

    const sentences = sentencesFromPlain(plain)
    FIGURE_RE.lastIndex = 0
    let fm: RegExpExecArray | null
    let foundFigure = false
    while ((fm = FIGURE_RE.exec(plain)) !== null) {
      foundFigure = true
      const absPos = (pm.index ?? 0) + (fm.index ?? 0)
      const sentence =
        sentences.find((s) => s.includes(fm![0].trim())) || plain
      claims.push({
        text: fm[0].trim(),
        position: absPos,
        figureText: fm[0].trim(),
        claimKind: classifyClaimKind(sentence),
        topicTerms: extractTopicTerms(sentence),
        claimText: sentence,
      })
    }

    // Policy assertion without a figure still matters for eligibility/rules
    if (
      !foundFigure &&
      /\b(require[sd]?|must|eligib|deadline|policy)\b/i.test(plain) &&
      /\b(grant|scheme|regulation|charg|dno|landlord|applicant)\b/i.test(plain)
    ) {
      claims.push({
        text: plain.slice(0, 80),
        position: pm.index ?? 0,
        claimKind: classifyClaimKind(plain),
        topicTerms: extractTopicTerms(plain),
        claimText: plain,
      })
    }
  }
  return claims
}

function contextContainsFigure(context: string, figure?: string): boolean {
  if (!figure) return false
  const hay = context.toLowerCase().replace(/\s+/g, ' ')
  const norm = normalizeFigure(figure)
  if (hay.includes(norm)) return true
  const bare = norm.replace(/[£$€]/g, '').replace(/\s+/g, '')
  if (bare.length >= 2 && hay.includes(bare)) return true
  return false
}

function urlLooksTopicalForClaim(url: string, claim: ExtractedFactualClaim): boolean {
  const u = url.toLowerCase()
  switch (claim.claimKind) {
    case 'grant':
    case 'government-policy':
    case 'eligibility':
      return /grant|scheme|charg|emission|ozev|eligib|subsid|fund|low-emission/i.test(u)
    case 'tax-legal':
      return /tax|duty|levy|hmrc|revenue|vehicle-tax/i.test(u)
    case 'regulation':
      return /regulation|legislation|statutory|ofgem|standards?/i.test(u)
    case 'statistic':
    case 'price':
      return /grant|scheme|charg|statistic|price|cost|emission|ozev/i.test(u)
    default:
      return /grant|scheme|policy|guidance|eligib/i.test(u)
  }
}

function topicOverlap(a: Set<string>, b: Set<string>): string[] {
  return Array.from(a).filter((t) => b.has(t))
}

export type BindClaimSourceResult = {
  source: ClaimSourceRef | null
  /** How strongly the source supports this specific claim. */
  supportTier: 'figure-in-context' | 'topical-official' | 'topical-secondary' | 'none'
}

/**
 * Bind a source to ONE claim. Does not treat "any official link in the
 * document" as support — the citation must relate to this claim.
 */
export function bindSourceToClaim(
  claim: ExtractedFactualClaim,
  citations: ArticleCitation[],
): BindClaimSourceResult {
  // Tier 1: topical official citation whose tight context mentions this figure
  if (claim.figureText) {
    for (const c of citations) {
      if (!isOfficialClaimUrl(c.url)) continue
      if (!urlLooksTopicalForClaim(c.url, claim)) continue
      if (contextContainsFigure(c.contextText, claim.figureText)) {
        return {
          supportTier: 'figure-in-context',
          source: {
            url: c.url,
            authority: 'official',
            supportingPassage: c.contextText.slice(0, 240),
          },
        }
      }
    }
  }

  // Soft topical bind for statistic/price: require URL topicality AND
  // either figure-in-context or strong topic overlap — never inherit a
  // sibling claim's citation just because it is on the same grants page.
  // (Tier 2 already requires ≥2 shared topic terms.)

  // Tier 2: official URL topical for this claim kind + ≥2 shared topic terms
  // Exclude generic stop-ish overlap that every paragraph shares.
  const WEAK_OVERLAP = new Set([
    'costs', 'cost', 'toward', 'towards', 'installation', 'hardware', 'labour',
    'labor', 'flats', 'separately', 'offers', 'available', 'claim', 'claims',
  ])
  let best: { c: ArticleCitation; shared: number } | null = null
  for (const c of citations) {
    if (!isOfficialClaimUrl(c.url)) continue
    if (!urlLooksTopicalForClaim(c.url, claim)) continue
    const shared = topicOverlap(claim.topicTerms, c.topicTerms).filter((t) => !WEAK_OVERLAP.has(t))
    if (shared.length >= 2) {
      if (!best || shared.length > best.shared) best = { c, shared: shared.length }
    }
  }
  if (best) {
    return {
      supportTier: 'topical-official',
      source: {
        url: best.c.url,
        authority: 'official',
        supportingPassage: best.c.contextText.slice(0, 240),
      },
    }
  }

  // Tier 3: secondary source with strong topic overlap (partial only)
  for (const c of citations) {
    if (isOfficialClaimUrl(c.url)) continue
    const shared = topicOverlap(claim.topicTerms, c.topicTerms)
    if (shared.length >= 2 || (claim.figureText && contextContainsFigure(c.contextText, claim.figureText))) {
      return {
        supportTier: 'topical-secondary',
        source: {
          url: c.url,
          authority: 'secondary',
          supportingPassage: c.contextText.slice(0, 240),
        },
      }
    }
  }

  return { supportTier: 'none', source: null }
}

export function buildClaimRecommendedAction(ev: Pick<ClaimEvidence, 'status' | 'source' | 'figureText' | 'claimText'>): string {
  switch (ev.status) {
    case 'SUPPORTED':
    case 'HISTORICAL':
      return 'No action required — this claim is supported by a bound source.'
    case 'CONTRADICTED':
    case 'OUTDATED':
      return ev.source?.url
        ? `Update the claim to match ${ev.source.url}, or rewrite it as a clearly historical statement.`
        : 'Update or remove the outdated claim using the current official figure.'
    case 'PARTIALLY_SUPPORTED':
      return 'Confirm the bound source actually states this figure; tighten the citation or supporting sentence if needed.'
    case 'NEEDS_REVIEW':
      return 'Verify this claim against the official source before publishing.'
    case 'UNSUPPORTED':
    default:
      return ev.figureText
        ? `Add a link to the official page that states "${ev.figureText}" (a citation for a different claim elsewhere is not enough).`
        : 'Add an official source link that actually supports this claim.'
  }
}

/**
 * Derive product-facing claim status from binding + optional time/live signals.
 */
export function deriveClaimEvidenceStatus(input: {
  supportTier: BindClaimSourceResult['supportTier']
  /** Freshness time framing when known. */
  timeStatus?: 'CURRENT' | 'HISTORICAL' | 'FUTURE' | 'OUTDATED' | 'NEEDS_REVIEW'
  /** Live/fixture contradiction. */
  contradicted?: boolean
  outdated?: boolean
}): ClaimEvidenceStatus {
  if (input.contradicted) return 'CONTRADICTED'
  if (input.outdated || input.timeStatus === 'OUTDATED') return 'OUTDATED'
  if (input.timeStatus === 'HISTORICAL' && input.supportTier !== 'none') return 'HISTORICAL'
  if (input.supportTier === 'figure-in-context') return 'SUPPORTED'
  if (input.supportTier === 'topical-official') {
    // Topical official without the figure in context — partial until live verify
    return 'PARTIALLY_SUPPORTED'
  }
  if (input.supportTier === 'topical-secondary') return 'PARTIALLY_SUPPORTED'
  if (input.timeStatus === 'NEEDS_REVIEW') return 'NEEDS_REVIEW'
  return 'UNSUPPORTED'
}

function rationaleFor(
  status: ClaimEvidenceStatus,
  supportTier: BindClaimSourceResult['supportTier'],
  occurrenceCount: number,
): string {
  const restated =
    occurrenceCount > 1
      ? ` Claim appears ${occurrenceCount} times — one supporting citation covers every restatement (no need to repeat the link after each sentence).`
      : ''
  switch (status) {
    case 'SUPPORTED':
      return `Bound source mentions this figure in article context.${restated}`
    case 'HISTORICAL':
      return `Historical claim bound to a topical official source.${restated}`
    case 'PARTIALLY_SUPPORTED':
      return supportTier === 'topical-secondary'
        ? `Secondary source is topically related but not authoritative.${restated}`
        : `Official source is topically related but the figure was not found in the citation's article context — confirm the page actually states this claim.${restated}`
    case 'UNSUPPORTED':
      return `No citation in this article actually supports this claim. Other document-level citations for different topics do not count.${restated}`
    case 'OUTDATED':
      return `Claim appears outdated relative to authoritative evidence.${restated}`
    case 'CONTRADICTED':
      return `Authoritative evidence contradicts this claim.${restated}`
    case 'NEEDS_REVIEW':
      return `Claim needs human verification.${restated}`
    default:
      return restated.trim()
  }
}

/**
 * Evaluate claim-level evidence for the whole article.
 * Dedupes by claim identity so restatements are not punished.
 */
export function evaluateClaimEvidence(articleHtml: string): ClaimEvidence[] {
  const scoped = articleVisibleHtml(articleHtml)
  const citations = extractArticleCitations(scoped)
  const extracted = extractImportantFactualClaims(articleHtml)

  const groups = new Map<string, ExtractedFactualClaim[]>()
  for (const c of extracted) {
    const key = claimIdentityKey(c)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }

  const results: ClaimEvidence[] = []
  for (const [claimId, group] of Array.from(groups.entries())) {
    const representative = group[0]
    const { source, supportTier } = bindSourceToClaim(representative, citations)
    const status = deriveClaimEvidenceStatus({ supportTier })
    const occurrenceCount = group.length
    const ev: ClaimEvidence = {
      claimId,
      claimText: representative.claimText,
      claimKind: representative.claimKind,
      figureText: representative.figureText,
      occurrenceCount,
      source,
      status,
      rationale: rationaleFor(status, supportTier, occurrenceCount),
      recommendedAction: '',
    }
    ev.recommendedAction = buildClaimRecommendedAction(ev)
    results.push(ev)
  }
  return results
}

/**
 * Coarse evidence-only severity (no freshness axis).
 *
 * Quality Gate claim issues MUST use decideClaimIssue() instead — that is the
 * authoritative evidence × freshness → severity/title/dimension mapping.
 * Kept for tests/debug of the claim-evidence module alone.
 */
export function severityForClaimEvidence(
  status: ClaimEvidenceStatus,
): 'critical' | 'warning' | 'info' | null {
  switch (status) {
    case 'CONTRADICTED':
    case 'OUTDATED':
    case 'UNSUPPORTED':
      // Material financial/policy figures are treated as critical by decideClaimIssue;
      // this helper matches that default for the evidence-only path.
      return 'critical'
    case 'NEEDS_REVIEW':
    case 'PARTIALLY_SUPPORTED':
      return 'warning'
    case 'HISTORICAL':
      return 'info'
    case 'SUPPORTED':
      // Evidence axis alone is fine; currency unknown is a separate freshness advisory
      // owned by decideClaimIssue (info), not a factual failure here.
      return null
    default:
      return 'warning'
  }
}

/**
 * Enrich a ClaimEvidence record with live/fixture source metadata
 * (date, passage, contradiction) without hard-coding policy figures.
 */
export function applyLiveSourceEvidence(
  claim: ClaimEvidence,
  live: {
    sourceUrl?: string
    sourceDate?: string | null
    supportingPassage?: string | null
    figureFound?: boolean
    contradicted?: boolean
    outdated?: boolean
    historicalSupported?: boolean
  },
): ClaimEvidence {
  const next: ClaimEvidence = {
    ...claim,
    source: claim.source
      ? {
          ...claim.source,
          url: live.sourceUrl || claim.source.url,
          sourceDate: live.sourceDate ?? claim.source.sourceDate,
          supportingPassage:
            live.supportingPassage ?? claim.source.supportingPassage,
        }
      : live.sourceUrl
        ? {
            url: live.sourceUrl,
            authority: sourceAuthorityForUrl(live.sourceUrl),
            sourceDate: live.sourceDate,
            supportingPassage: live.supportingPassage,
          }
        : null,
  }

  if (live.contradicted) {
    next.status = 'CONTRADICTED'
  } else if (live.outdated) {
    next.status = 'OUTDATED'
  } else if (live.historicalSupported) {
    next.status = 'HISTORICAL'
  } else if (live.figureFound === true) {
    next.status = 'SUPPORTED'
  } else if (live.figureFound === false && next.source) {
    next.status = 'NEEDS_REVIEW'
    next.rationale =
      'Citation bound, but the figure was not found on the source page — confirm or update the claim.'
  }

  next.recommendedAction = buildClaimRecommendedAction(next)
  if (live.contradicted || live.outdated) {
    next.rationale = [
      live.sourceDate ? `Source updated ${live.sourceDate}` : null,
      live.supportingPassage ? `Passage: ${live.supportingPassage.slice(0, 160)}` : null,
      next.rationale,
    ]
      .filter(Boolean)
      .join('. ')
  }
  return next
}

/** Format claim evidence for Quality Gate issue descriptions. */
export function formatClaimEvidenceDescription(ev: ClaimEvidence): string {
  const parts = [`Claim: "${ev.claimText.slice(0, 220)}"`]
  if (ev.source?.url) {
    parts.push(`Source: ${ev.source.url}`)
    if (ev.source.sourceDate) parts.push(`Source date: ${ev.source.sourceDate}`)
    parts.push(`Source authority: ${ev.source.authority}`)
    if (ev.source.supportingPassage) {
      parts.push(`Supporting passage: "${ev.source.supportingPassage.slice(0, 160)}"`)
    }
  } else {
    parts.push('Source: none bound to this claim')
  }
  parts.push(`Claim status: ${ev.status}`)
  parts.push(`Evidence: ${ev.rationale}`)
  parts.push(`Recommended action: ${ev.recommendedAction}`)
  if (ev.occurrenceCount > 1) {
    parts.push(`Occurrences: ${ev.occurrenceCount} (one citation covers all restatements)`)
  }
  return parts.join('\n')
}

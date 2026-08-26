// src/lib/temporal-claims.ts
// C04 (temporal-claims spec) — a stricter, registry-backed sibling to
// dated-claim-detector.ts's existing detectTimeAnchoredClaims. That system
// already ships, is tested, and is wired into the live Quality Gate at
// document-wide citation binding with a 180-day review window (JSONB
// column). This module implements the newer spec's DIFFERENT rule exactly
// as written: citation must be in the SAME SENTENCE (not just anywhere in
// the article), a 90-day review window, and every passing claim is
// persisted to the temporal_claims table (see supabase/migrations) for the
// freshness job to re-verify later. The two systems are intentionally kept
// separate rather than merged — merging them would mean picking one
// window/binding rule and silently changing the other's already-shipped
// behavior.
//
// Detector first, then the mechanical repair loop — never a prompt-only fix.

import { paragraphsFromHtml, splitIntoSentences } from './dated-claim-detector'

export interface TemporalClaim {
  sentence: string
  matchedMarker: string
  charOffset: number
  hasSameSentenceCitation: boolean
  citationUrl: string | null
  qualifyingTerm: string
}

const MONTH_NAMES_RE =
  '(?:January|February|March|April|May|June|July|August|September|October|November|December)'

// "percentage, currency amount, rate, grant, threshold, limit, deadline,
// eligibility" — the exact qualifying-term list from the spec.
const QUALIFYING_TERM_RE =
  /[£$€]\s?\d(?:[\d,]*\d)?(?:\.\d+)?|\d+(?:\.\d+)?\s?%|\b(?:rate|grant|threshold|limit|deadline|eligibility)\b/i

const TEMPORAL_MARKERS: Array<{ name: string; re: RegExp }> = [
  { name: 'as-of-month-year', re: new RegExp(`\\bas of\\s+${MONTH_NAMES_RE}\\s+(?:19|20)\\d{2}\\b`, 'i') },
  { name: 'as-of-today', re: /\bas of today\b/i },
  { name: 'at-the-time-of-writing', re: /\bat the time of writing\b/i },
  { name: 'currently', re: /\bcurrently\b/i },
  // Bare "<Month> <Year>" without "as of" — checked after as-of-month-year
  // so a sentence with "as of August 2026" is tagged with the more specific
  // marker name; a sentence still matches whichever markers are present.
  { name: 'bare-month-year', re: new RegExp(`\\b${MONTH_NAMES_RE}\\s+(?:19|20)\\d{2}\\b`, 'i') },
  { name: 'this-year', re: /\bthis year\b/i },
]

function findQualifyingTerm(sentence: string): string | null {
  const m = sentence.match(QUALIFYING_TERM_RE)
  return m ? m[0].trim() : null
}

/**
 * True same-sentence check: does an <a href> whose visible anchor text
 * appears within this sentence's plain text exist in the paragraph's HTML?
 * `sentence` is plain text (tags already stripped by paragraphsFromHtml),
 * so we can't regex the sentence itself for a tag — instead we walk every
 * anchor in the paragraph's raw HTML and test whether ITS visible text is a
 * substring of this sentence. A citation whose anchor text lands in a
 * different sentence of the same paragraph does not count.
 */
function findSameSentenceCitation(
  sentence: string,
  innerHtml: string,
): { has: boolean; url: string | null } {
  const anchorRe = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = anchorRe.exec(innerHtml)) !== null) {
    const url = m[1]
    const anchorText = m[2].replace(/<[^>]+>/g, '').trim()
    if (anchorText && sentence.includes(anchorText)) {
      return { has: true, url }
    }
  }
  return { has: false, url: null }
}

/**
 * A marker alone is not a violation — only flag when it co-occurs, in the
 * same sentence, with a figure or policy term. "This year" or "currently"
 * on their own are common, harmless phrasing; do not over-trigger.
 */
export function detectTemporalClaims(articleHtml: string): TemporalClaim[] {
  const claims: TemporalClaim[] = []

  for (const { innerHtml, text, position } of paragraphsFromHtml(articleHtml)) {
    for (const sentence of splitIntoSentences(text)) {
      const qualifyingTerm = findQualifyingTerm(sentence)
      if (!qualifyingTerm) continue

      const sentenceOffsetInParagraph = text.indexOf(sentence)
      const charOffset = position + Math.max(0, sentenceOffsetInParagraph)

      for (const { name, re } of TEMPORAL_MARKERS) {
        if (!re.test(sentence)) continue
        const citation = findSameSentenceCitation(sentence, innerHtml)
        claims.push({
          sentence,
          matchedMarker: name,
          charOffset,
          hasSameSentenceCitation: citation.has,
          citationUrl: citation.url,
          qualifyingTerm,
        })
      }
    }
  }

  return claims
}

export interface TemporalClaimRow {
  article_id: string
  user_id: string
  claim_text: string
  source_url: string
  detected_at: string
  review_by: string
  status: 'active'
}

const REVIEW_WINDOW_DAYS = 90

/**
 * Pure row-shape builder for the temporal_claims table — the actual insert
 * runs wherever a Supabase client is already in scope (article-v2/route.ts).
 * Only claims with a same-sentence citation are registered; a claim with
 * no citation was either repaired (no longer matches a marker, so it never
 * reaches here) or is a genuine unresolved failure that should not be
 * silently persisted as if it passed.
 */
export function buildTemporalClaimRows(
  claims: TemporalClaim[],
  opts: { articleId: string; userId: string; now?: Date },
): TemporalClaimRow[] {
  const now = opts.now ?? new Date()
  const detectedAt = now.toISOString()
  const reviewBy = new Date(now.getTime() + REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const uniqueCited = Array.from(
    new Map(
      claims
        .filter(c => c.hasSameSentenceCitation && c.citationUrl)
        .map(c => [c.sentence.trim(), c]),
    ).values(),
  )

  return uniqueCited.map(c => ({
    article_id: opts.articleId,
    user_id: opts.userId,
    claim_text: c.sentence,
    source_url: c.citationUrl!,
    detected_at: detectedAt,
    review_by: reviewBy,
    status: 'active' as const,
  }))
}

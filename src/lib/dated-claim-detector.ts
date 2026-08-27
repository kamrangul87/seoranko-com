// src/lib/dated-claim-detector.ts
// Flags a temporal expression when it co-occurs with a quantitative/policy
// claim (a %, a currency figure, or a policy-machinery term like "grant" /
// "scheme" / "policy" / "fund" / "subsidy" / "rate") and has no named source
// nearby. Global/market-agnostic pattern-based detection — not the UK grant
// example it was modelled on. Complements article-quality-gate.ts's existing
// DANGEROUS_FACT_PATTERNS (a narrower, UK-grant-specific regex) with a
// chrono-node-based detector that recognises ANY temporal expression, not
// just "as of <Month> <Year>".

import * as chrono from 'chrono-node'
import { hasNamedSource } from './fact-checker'
import { isAdvisoryOpinionSentence, requiresCitation } from './claim-factuality'

export interface DatedClaim {
  text: string      // the temporal expression itself, e.g. "August 2026"
  sentence: string   // the sentence it appears in
  hasSource: boolean
  reviewBy: string   // ISO date — when this claim should be re-checked
}

const POLICY_QUANTITATIVE_RE =
  /[£$€]\s?\d|\d+\s?%|\b(grant|scheme|fund(?:ing)?|subsid(?:y|ies)|rebate|allowance|rate|policy|tariff|threshold|cap)\b/i

const HISTORICAL_FRAMING_RE =
  /\b(introduced|launched|established|created|began|started|enacted|formed|opened|commenced|inaugurated)\b/i

const REVIEW_WINDOW_DAYS = 90

export function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map(s => s.trim())
    .filter(Boolean)
}

export function paragraphsFromHtml(html: string): Array<{ innerHtml: string; text: string; position: number }> {
  const results: Array<{ innerHtml: string; text: string; position: number }> = []
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const innerHtml = m[1]
    const text = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    results.push({ innerHtml, text, position: m.index })
  }
  return results
}

/** Fixed historical dates ("introduced in April 2022") don't go stale. */
function isHistoricalEstablishmentClaim(sentence: string, claimDate: Date, now: Date): boolean {
  if (claimDate >= now) return false
  return HISTORICAL_FRAMING_RE.test(sentence)
}

function claimHasSource(sentence: string, innerHtml: string): boolean {
  return hasNamedSource(sentence) || /href=/i.test(innerHtml)
}

export function detectDatedClaims(html: string, now: Date): DatedClaim[] {
  const claims: DatedClaim[] = []
  const reviewBy = new Date(now.getTime() + REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  for (const { innerHtml, text } of paragraphsFromHtml(html)) {
    for (const sentence of splitIntoSentences(text)) {
      // Advisory/opinion without a verifiable figure/date/rule is not a
      // dated-policy claim (e.g. "smarter choice … charger now" + grant noun).
      if (!requiresCitation(sentence)) continue
      if (!POLICY_QUANTITATIVE_RE.test(sentence)) continue
      const temporalMatches = chrono.parse(sentence, now)
      if (temporalMatches.length === 0) continue

      for (const match of temporalMatches) {
        const claimDate = match.start.date()
        if (isHistoricalEstablishmentClaim(sentence, claimDate, now)) continue

        claims.push({
          text: match.text,
          sentence,
          hasSource: claimHasSource(sentence, innerHtml),
          reviewBy,
        })
      }
    }
  }

  return claims
}

// ── Stale year in title/headings/meta description ───────────────────────
// Separate from the sourced-claim logic above by design: that check flags
// a QUANTITATIVE claim tied to a date with no named source nearby (e.g. "as
// of August 2026, the grant covers 75%"). This one catches a different,
// simpler defect — a flat WRONG year sitting in a title, heading, or meta
// description (e.g. "Used EV Buyers in 2024" on an article whose
// datePublished/dateModified/"Last verified" line all say August 2026).
// No historical-establishment exemption here (unlike detectDatedClaims'
// isHistoricalEstablishmentClaim): a title/heading/description is a topic
// label asserting "this is current as of <year>", not a sentence reporting
// a fixed past event — any year that isn't the actual publish year is
// either stale or, at minimum, needs a human to confirm it's intentional.

export interface StaleYearReference {
  location: 'title' | 'heading' | 'meta-description'
  text: string
  year: number
}

const YEAR_RE = /\b(?:19|20)\d{2}\b/g

export function extractHeadingTexts(html: string): string[] {
  const headings: string[] = []
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, '').trim()
    if (text) headings.push(text)
  }
  return headings
}

export function detectStaleYearReferences(
  input: { title?: string; headings?: string[]; metaDescription?: string },
  publishYear: number,
): StaleYearReference[] {
  const found: StaleYearReference[] = []

  const scan = (location: StaleYearReference['location'], text: string | undefined) => {
    if (!text) return
    const years = text.match(YEAR_RE)
    if (!years) return
    for (const raw of years) {
      const year = parseInt(raw, 10)
      if (year !== publishYear) found.push({ location, text, year })
    }
  }

  scan('title', input.title)
  for (const heading of input.headings || []) scan('heading', heading)
  scan('meta-description', input.metaDescription)

  return found
}

// ── Time-anchored claims (Quality Gate rule C04) ─────────────────────────
// detectDatedClaims above only fires when chrono-node can parse an actual
// date token out of the sentence. A repeat failure mode in this repo is a
// figure anchored to "now" with NO parseable date at all — "currently, the
// grant covers 75%" or "the current rate is £350" — which chrono-node has
// nothing to latch onto. These patterns catch that broader, date-token-free
// class of relative claim. Deliberately pattern-based rather than a rewrite
// of the write prompt: the prompt has already been given date context (see
// todayContext() in article-master.ts) and a hint not to do this — this is
// the mechanical backstop for when it does anyway.

export interface TimeAnchoredClaim {
  sentence: string
  matchedPattern: string
  charOffset: number
  hasOutboundCitationInSentence: boolean
  extractedNumericValue: string | null
  assertedOn: string   // ISO date (YYYY-MM-DD) this claim was detected
  reviewBy: string      // ISO date (YYYY-MM-DD) — assertedOn + 180 days
}

const MONTH_NAMES_RE = '(?:January|February|March|April|May|June|July|August|September|October|November|December)'

// A currency/percent figure is the reliable "this is a quantitative claim"
// signal — reused from POLICY_QUANTITATIVE_RE's currency/percent half, kept
// separate from the policy-word half so a bare year (e.g. "2026") is never
// mistaken for the claimed figure.
const QUANTITATIVE_TOKEN_RE = /[£$€]\s?\d(?:[\d,]*\d)?(?:\.\d+)?|\d+(?:\.\d+)?\s?%/i
const GROUPED_OR_DECIMAL_NUMBER_RE = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+\.\d+\b/

function extractNumericValue(sentence: string): string | null {
  const currencyOrPercent = sentence.match(QUANTITATIVE_TOKEN_RE)
  if (currencyOrPercent) return currencyOrPercent[0].trim()
  const grouped = sentence.match(GROUPED_OR_DECIMAL_NUMBER_RE)
  if (grouped) return grouped[0].trim()
  return null
}

const TIME_ANCHORED_PATTERNS: Array<{ name: string; test: (sentence: string) => boolean }> = [
  {
    name: 'as-of-date',
    test: (s) => new RegExp(`\\bas of\\s+(?:${MONTH_NAMES_RE}\\s+)?(?:19|20)\\d{2}\\b`, 'i').test(s),
  },
  {
    name: 'currently-quantitative',
    test: (s) => /\bcurrently\b/i.test(s) && QUANTITATIVE_TOKEN_RE.test(s),
  },
  {
    name: 'year-quantitative',
    test: (s) => /\b(?:in|for|during)\s+(?:19|20)\d{2}\b/i.test(s) && QUANTITATIVE_TOKEN_RE.test(s),
  },
  {
    name: 'current-rate-is',
    test: (s) => /\bthe current (?:rate|price|limit|grant|threshold|cap|allowance) is\b/i.test(s),
  },
  {
    name: 'month-year-update',
    test: (s) => new RegExp(`\\b${MONTH_NAMES_RE}\\s+(?:19|20)\\d{2}\\s+(?:update|figures|rates|data)\\b`, 'i').test(s),
  },
  {
    name: 'will-change-by-year',
    test: (s) => /\bwill\s+(?:rise|fall|increase|decrease|change)\s+(?:in|by)\s+(?:19|20)\d{2}\b/i.test(s),
  },
]

export function detectTimeAnchoredClaims(articleHtml: string, now: Date = new Date()): TimeAnchoredClaim[] {
  const claims: TimeAnchoredClaim[] = []
  const assertedOn = now.toISOString().slice(0, 10)
  const reviewBy = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  for (const { innerHtml, text, position } of paragraphsFromHtml(articleHtml)) {
    for (const sentence of splitIntoSentences(text)) {
      if (isAdvisoryOpinionSentence(sentence) || !requiresCitation(sentence)) continue
      const sentenceOffsetInParagraph = text.indexOf(sentence)
      const charOffset = position + Math.max(0, sentenceOffsetInParagraph)

      for (const { name, test } of TIME_ANCHORED_PATTERNS) {
        if (!test(sentence)) continue
        claims.push({
          sentence,
          matchedPattern: name,
          charOffset,
          hasOutboundCitationInSentence: claimHasSource(sentence, innerHtml),
          extractedNumericValue: extractNumericValue(sentence),
          assertedOn,
          reviewBy,
        })
      }
    }
  }

  return claims
}

export function buildLastVerifiedLine(verifiedAt: string): string {
  const formatted = new Date(verifiedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  return `<p class="article-last-verified" style="font-size:0.85rem;color:#6B6B6B;">Last verified: ${formatted}</p>`
}

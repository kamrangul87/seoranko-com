/**
 * Shared sentence-boundary helpers for scannability / paragraph splitting.
 *
 * Authoritative implementation — structure-validator, scannability-fixer, and
 * paragraph-splitter MUST use these functions (never local /[.!?]/ counters).
 *
 * Domain-like tokens (gov.uk, energynetworks.org), URLs, and decimals must be
 * masked before counting or splitting on "." — otherwise they inflate counts.
 */

import { SCANNABILITY_POLICY } from './scannability-policy'

const DOMAIN_TOKEN_RE = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi
const DECIMAL_RE = /\d+\.\d+/g
/** Practical abbreviation stubs — length-preserving mask of the trailing dot. */
const ABBREV_RE =
  /\b(?:e\.g|i\.e|etc|approx|approx\.|mr|mrs|ms|dr|prof|vs|no|vol|fig|eds?)\./gi

function maskMatchPreserveLength(m: string): string {
  return Array.from(m, (ch) => {
    if (ch >= 'A' && ch <= 'Z') return 'X'
    if (ch >= 'a' && ch <= 'z') return 'x'
    return 'x'
  }).join('')
}

/**
 * Length-preserving mask so offsets stay aligned with the original string.
 * Letter case is preserved on domains so a following capital after ". Domain…"
 * still looks like a sentence start to the boundary lookahead.
 */
export function maskDomainLikeTokens(text: string): string {
  return text.replace(DOMAIN_TOKEN_RE, maskMatchPreserveLength)
}

/** Mask http(s) URLs so path dots never become sentence terminals. */
export function maskUrls(text: string): string {
  return text.replace(URL_RE, maskMatchPreserveLength)
}

/** Mask decimals like 7.4 / 22.0 so the point is not a sentence boundary. */
export function maskDecimals(text: string): string {
  return text.replace(DECIMAL_RE, maskMatchPreserveLength)
}

/** Mask common abbreviation dots (e.g., i.e., Dr.). */
export function maskAbbreviations(text: string): string {
  return text.replace(ABBREV_RE, maskMatchPreserveLength)
}

/**
 * Full pre-process before punctuation scanning — order matters:
 * URLs first (contain domains), then domains, decimals, abbreviations.
 */
export function maskNonSentencePeriods(text: string): string {
  return maskAbbreviations(maskDecimals(maskDomainLikeTokens(maskUrls(text))))
}

function toPlainText(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * End offsets (in the original string) of sentence-ending punctuation,
 * after non-sentence period masking. Does not include the final string length.
 *
 * A boundary requires terminal punctuation followed by whitespace and a
 * capital / quote / tag — so "7.4kW" and "gov.uk" never split.
 */
export function sentenceBoundaryOffsets(text: string): number[] {
  const masked = maskNonSentencePeriods(text)
  const boundaries: number[] = []
  const re = /[.!?]+(?=\s+[A-Z"'‘“<])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(masked)) !== null) {
    boundaries.push(m.index + m[0].length)
  }
  return boundaries
}

/**
 * Split plain (or lightly marked-up) text into sentences using the same
 * boundary offsets as the fixer/splitter.
 */
export function splitSentences(text: string): string[] {
  const plain = toPlainText(text)
  if (!plain) return []
  const ends = [...sentenceBoundaryOffsets(plain), plain.length]
  const parts: string[] = []
  let start = 0
  for (const end of ends) {
    const chunk = plain.slice(start, end).trim()
    if (chunk) parts.push(chunk)
    start = end
  }
  return parts
}

/**
 * Count sentences — ALWAYS the length of splitSentences (same algorithm as
 * boundary offsets). Never a raw /[.!?]+/g tally.
 */
export function countSentences(text: string): number {
  return splitSentences(text).length
}

/** True when a paragraph's sentence count meets the shared dense threshold. */
export function isDenseParagraph(text: string): boolean {
  return countSentences(text) >= SCANNABILITY_POLICY.denseSentenceThreshold
}

export { SCANNABILITY_POLICY }

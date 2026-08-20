/**
 * Phase 7 — semantic hedging evaluation.
 *
 * Do NOT treat repeated hedge words as automatically bad SEO.
 * Classify each finding so autofix only touches obvious boilerplate repetition.
 */

export type HedgingClass =
  | 'REAL_REPETITION'
  | 'APPROPRIATE_QUALIFICATION'
  | 'UNSUPPORTED_CLAIM'
  | 'OVER_HEDGING'

export type HedgeToken =
  | 'typically'
  | 'generally'
  | 'usually'
  | 'approximately'
  | 'often'
  | 'may'
  | 'can'
  | 'might'
  | 'could'
  | 'sometimes'
  | 'tend to'

const HEDGE_PATTERNS: Array<{ token: HedgeToken; re: RegExp }> = [
  { token: 'tend to', re: /\btend to\b/gi },
  { token: 'typically', re: /\btypically\b/gi },
  { token: 'generally', re: /\bgenerally\b/gi },
  { token: 'usually', re: /\busually\b/gi },
  { token: 'approximately', re: /\bapproximately\b/gi },
  { token: 'sometimes', re: /\bsometimes\b/gi },
  { token: 'often', re: /\boften\b/gi },
  { token: 'might', re: /\bmight\b/gi },
  { token: 'could', re: /\bcould\b/gi },
  { token: 'may', re: /\bmay\b/gi },
  { token: 'can', re: /\bcan\b/gi },
]

/** Variability / soft-fact cues — hedging is often appropriate nearby. */
const VARIABILITY_RE =
  /\b(depend|varies|variable|range|between|up to|around|roughly|most|many|some|few|average|typically cost|household|driver|site|install)\b/i

/** Hard-fact cues — hedging a precise figure without a source looks unsupported. */
const HARD_FACT_RE =
  /[£$€]\s?\d|\d+\s?%|\b(exactly|precisely|always|never|must|required by law|statutory)\b/i

const BOILERPLATE_HEDGE_RE =
  /\bit is (?:typically|generally|usually) (?:important|recommended|advised|worth)\b/i

export interface HedgeOccurrence {
  token: HedgeToken
  sentence: string
  index: number
  classification: HedgingClass
  rationale: string
}

export interface HedgingEvaluation {
  wordCount: number
  totalHedges: number
  /** Hedges per 100 words. */
  densityPer100: number
  byToken: Record<string, number>
  occurrences: HedgeOccurrence[]
  /** Only these should surface as Quality Gate warnings. */
  actionable: HedgeOccurrence[]
  /** Safe autofix targets (boilerplate / real repetition only). */
  autoFixableTokens: HedgeToken[]
  summary: string
}

function stripToPlain(htmlOrText: string): string {
  return htmlOrText
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function classifyOccurrence(token: HedgeToken, sentence: string, tokenCountInDoc: number): HedgingClass {
  if (BOILERPLATE_HEDGE_RE.test(sentence)) {
    return 'REAL_REPETITION'
  }

  // Precise claim + hedge + no soft variability framing → may be unsupported certainty dodge
  if (HARD_FACT_RE.test(sentence) && !VARIABILITY_RE.test(sentence) && (token === 'typically' || token === 'generally' || token === 'usually')) {
    // "The grant is typically £500" without variability context — soft-flag as unsupported framing
    if (/[£$€]\s?\d|\d+\s?%/.test(sentence)) {
      return 'UNSUPPORTED_CLAIM'
    }
  }

  if (VARIABILITY_RE.test(sentence) || token === 'may' || token === 'can' || token === 'might' || token === 'could' || token === 'approximately') {
    // Appropriate unless the same token is piled on absurdly in one sentence
    const inSentence = (sentence.match(new RegExp(`\\b${token.replace(/\s+/g, '\\s+')}\\b`, 'gi')) || []).length
    if (inSentence >= 3) return 'OVER_HEDGING'
    if (tokenCountInDoc <= 8) return 'APPROPRIATE_QUALIFICATION'
  }

  // Document-level pile-up of the same filler hedge
  if ((token === 'typically' || token === 'generally' || token === 'usually') && tokenCountInDoc >= 12) {
    return 'OVER_HEDGING'
  }
  if ((token === 'typically' || token === 'generally') && tokenCountInDoc >= 6 && !VARIABILITY_RE.test(sentence)) {
    return 'REAL_REPETITION'
  }

  return 'APPROPRIATE_QUALIFICATION'
}

function rationaleFor(c: HedgingClass, token: string): string {
  switch (c) {
    case 'REAL_REPETITION':
      return `"${token}" looks like repetitive boilerplate rather than meaningful qualification.`
    case 'APPROPRIATE_QUALIFICATION':
      return `"${token}" appropriately marks variability or uncertainty — not an SEO defect.`
    case 'UNSUPPORTED_CLAIM':
      return `"${token}" softens a precise figure/claim without clear variability context — verify or cite.`
    case 'OVER_HEDGING':
      return `Too many "${token}" hedges in close proximity — reduce for clarity, not for a keyword quota.`
  }
}

export function evaluateHedging(htmlOrText: string): HedgingEvaluation {
  const plain = stripToPlain(htmlOrText)
  const wordCount = plain.split(/\s+/).filter(Boolean).length || 1
  const sentences = splitSentences(plain)

  const byToken: Record<string, number> = {}
  for (const { token, re } of HEDGE_PATTERNS) {
    const n = (plain.match(re) || []).length
    if (n > 0) byToken[token] = n
  }
  const totalHedges = Object.values(byToken).reduce((a, b) => a + b, 0)
  const densityPer100 = (totalHedges / wordCount) * 100

  const occurrences: HedgeOccurrence[] = []
  for (const sentence of sentences) {
    for (const { token, re } of HEDGE_PATTERNS) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      const local = new RegExp(re.source, 'gi')
      while ((m = local.exec(sentence)) !== null) {
        const classification = classifyOccurrence(token, sentence, byToken[token] || 0)
        occurrences.push({
          token,
          sentence,
          index: m.index,
          classification,
          rationale: rationaleFor(classification, token),
        })
      }
    }
  }

  const actionable = occurrences.filter(
    (o) =>
      o.classification === 'REAL_REPETITION' ||
      o.classification === 'OVER_HEDGING' ||
      o.classification === 'UNSUPPORTED_CLAIM',
  )

  const autoFixableTokens: HedgeToken[] = []
  const realRepTypically = actionable.filter(
    (o) => o.token === 'typically' && o.classification === 'REAL_REPETITION',
  ).length
  if (realRepTypically >= 3) autoFixableTokens.push('typically')

  const summary =
    actionable.length === 0
      ? `Hedging density ${densityPer100.toFixed(1)}/100 words — qualifications look appropriate.`
      : `${actionable.length} hedging finding(s) need attention (${Array.from(new Set(actionable.map((a) => a.classification))).join(', ')}). Density ${densityPer100.toFixed(1)}/100 words.`

  return {
    wordCount,
    totalHedges,
    densityPer100,
    byToken,
    occurrences,
    actionable,
    autoFixableTokens,
    summary,
  }
}

/** Density threshold: only OVER_HEDGING at document level when extreme. */
export function isExtremeHedgeDensity(evaluation: HedgingEvaluation): boolean {
  // > 3 hedges per 100 words is noisy; still classify per-sentence first
  return evaluation.densityPer100 > 3.5 && evaluation.actionable.length >= 5
}

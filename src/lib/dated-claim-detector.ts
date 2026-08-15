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

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map(s => s.trim())
    .filter(Boolean)
}

function paragraphsFromHtml(html: string): Array<{ innerHtml: string; text: string }> {
  const results: Array<{ innerHtml: string; text: string }> = []
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const innerHtml = m[1]
    const text = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    results.push({ innerHtml, text })
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

export function buildLastVerifiedLine(verifiedAt: string): string {
  const formatted = new Date(verifiedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  return `<p class="article-last-verified" style="font-size:0.85rem;color:#6B6B6B;">Last verified: ${formatted}</p>`
}

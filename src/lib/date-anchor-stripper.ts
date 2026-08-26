// src/lib/date-anchor-stripper.ts
// Deterministic removal of date anchors from policy/figure claims.
//
// Root cause of the recurring "dated-policy" warning: nothing ever removed
// these anchors. detectDatedClaims/detectTimeAnchoredClaims found them and
// the 90-day freshness automation scheduled a REVIEW for them, but review
// scheduling is a future promise — the article still shipped saying "As of
// August 2026, the grant covers up to 75%", so the Quality Gate warned on
// every run. The model-assisted repair (time-anchored-claim-repair.ts) only
// ran after the gate had already scored the article and depends on an LLM
// round-trip.
//
// This is the mechanical half: a pure string surgery that deletes the
// temporal anchor while leaving the figure, the sentence's subject and its
// citation untouched. Nothing is paraphrased, no number is altered — if a
// sentence does not match one of the explicit shapes below it is left
// alone and stays visible to the gate.

import { transformVisibleText } from './typography-normalizer'

const MONTHS = '(?:January|February|March|April|May|June|July|August|September|October|November|December)'
const MONTH_YEAR = `(?:${MONTHS}\\s+)?(?:19|20)\\d{2}`
const DAY_MONTH_YEAR = `(?:\\d{1,2}\\s+)?${MONTH_YEAR}`

interface AnchorRule {
  name: string
  pattern: RegExp
  replacement: string | ((...args: string[]) => string)
}

const ANCHOR_RULES: AnchorRule[] = [
  // "As of August 2026, the grant covers…" → "The grant covers…"
  {
    name: 'leading-as-of',
    pattern: new RegExp(`(^|[.!?]\\s+|>\\s*)[Aa]s of\\s+${DAY_MONTH_YEAR},?\\s+(\\w)`, 'g'),
    replacement: (_m: string, lead: string, firstChar: string) => `${lead}${firstChar.toUpperCase()}`,
  },
  // "…covers 75%, as of August 2026." → "…covers 75%."
  {
    name: 'trailing-as-of',
    pattern: new RegExp(`,?\\s+as of\\s+${DAY_MONTH_YEAR}\\b`, 'gi'),
    replacement: '',
  },
  // "The grant currently covers 75%" → "The grant covers 75%"
  {
    name: 'currently-adverb',
    pattern: /\s+currently\s+/gi,
    replacement: ' ',
  },
  // "Currently, the grant covers 75%" → "The grant covers 75%"
  {
    name: 'leading-currently',
    pattern: /(^|[.!?]\s+|>\s*)[Cc]urrently,\s+(\w)/g,
    replacement: (_m: string, lead: string, firstChar: string) => `${lead}${firstChar.toUpperCase()}`,
  },
  // "The current rate is £350" → "The rate is £350"
  {
    name: 'current-rate-is',
    pattern: /\b(the|The) current (rate|price|limit|grant|threshold|cap|allowance) is\b/g,
    replacement: (_m: string, article: string, noun: string) => `${article} ${noun} is`,
  },
  // "the August 2026 figures show…" → "the published figures show…"
  {
    name: 'month-year-qualifier',
    pattern: new RegExp(`\\b${MONTHS}\\s+(?:19|20)\\d{2}\\s+(update|figures|rates|data)\\b`, 'gi'),
    replacement: (_m: string, noun: string) => `published ${noun}`,
  },
]

export interface DateAnchorStripResult {
  html: string
  /** Rule names that actually fired, for logging / gate diagnostics. */
  appliedRules: string[]
  strippedCount: number
}

/**
 * Remove date anchors from visible article text. Markup, attributes,
 * JSON-LD and code blocks are never touched (transformVisibleText), so
 * `datePublished`/`dateModified`, citation URLs and the "Last verified:"
 * byline survive intact.
 */
export function stripDateAnchors(html: string): DateAnchorStripResult {
  if (!html) return { html, appliedRules: [], strippedCount: 0 }

  const applied = new Set<string>()
  let strippedCount = 0

  const out = transformVisibleText(html, (text) => {
    // Never rewrite the explicit freshness byline — that date is the point.
    if (/^\s*Last verified:/i.test(text)) return text

    let result = text
    for (const rule of ANCHOR_RULES) {
      const before = result
      result = result.replace(
        rule.pattern,
        rule.replacement as unknown as string,
      )
      if (result !== before) {
        applied.add(rule.name)
        strippedCount++
      }
    }
    // Tidy the whitespace/punctuation the deletions can leave behind.
    return result.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1')
  })

  return { html: out, appliedRules: Array.from(applied), strippedCount }
}

// src/lib/hedge-repetition-stripper.ts
// Mechanical reduction of repeated hedge boilerplate BEFORE Quality Gate.
//
// Keeps the first N uses of each filler hedge token and deletes later
// repeats so "typically" ×8 never reaches the readability warning. Modal
// hedges (may/can/might/could) use a slightly higher keep limit because
// deleting them changes modality more aggressively.

import { transformVisibleText } from './typography-normalizer'
import type { HedgeToken } from './hedging-policy'

/** Obvious filler boilerplate — always delete the hedge (never a "legitimate" first use). */
const BOILERPLATE_REWRITES: Array<{ re: RegExp; replacement: string }> = [
  {
    re: /\bit is (typically|generally|usually) (important|recommended|advised|worth)\b/gi,
    replacement: 'it is $2',
  },
  {
    re: /\bit(?:'s| is) (typically|generally|usually) (a good idea|best)\b/gi,
    replacement: 'it is $2',
  },
]

/** Filler hedges — safe to delete on excess (statement becomes more direct). */
const FILLER_HEDGES: Array<{ token: HedgeToken; re: RegExp; keep: number }> = [
  { token: 'tend to', re: /\btend to\b/gi, keep: 3 },
  { token: 'typically', re: /\btypically\b/gi, keep: 3 },
  { token: 'generally', re: /\bgenerally\b/gi, keep: 3 },
  { token: 'usually', re: /\busually\b/gi, keep: 3 },
  { token: 'approximately', re: /\bapproximately\b/gi, keep: 3 },
  { token: 'sometimes', re: /\bsometimes\b/gi, keep: 3 },
  { token: 'often', re: /\boften\b/gi, keep: 3 },
]

/** Modal hedges — keep a few more; still cap document-level pile-up. */
const MODAL_HEDGES: Array<{ token: HedgeToken; re: RegExp; keep: number }> = [
  { token: 'might', re: /\bmight\b/gi, keep: 4 },
  { token: 'could', re: /\bcould\b/gi, keep: 4 },
  { token: 'may', re: /\bmay\b/gi, keep: 4 },
  { token: 'can', re: /\bcan\b/gi, keep: 4 },
]

export interface HedgeRepetitionStripResult {
  html: string
  /** Per-token counts of occurrences removed. */
  removedByToken: Record<string, number>
  removedCount: number
}

/**
 * Keep the first legitimate uses of each hedge token; delete later repeats
 * so the sentence reads as a direct statement. Visible text only.
 * Counts are document-global across text nodes.
 *
 * Boilerplate "it is typically important" shapes are rewritten first so they
 * never consume the keep budget.
 */
export function stripHedgeRepetition(html: string): HedgeRepetitionStripResult {
  if (!html) return { html, removedByToken: {}, removedCount: 0 }

  const removedByToken: Record<string, number> = {}
  const counters = new Map<string, number>()

  const out = transformVisibleText(html, (text) => {
    let result = text

    for (const { re } of BOILERPLATE_REWRITES) {
      const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
      result = result.replace(global, (match, hedge: string, rest: string) => {
        const token = String(hedge).toLowerCase()
        removedByToken[token] = (removedByToken[token] || 0) + 1
        const rebuilt = `it is ${rest}`
        if (/^[A-Z]/.test(match)) {
          return rebuilt.charAt(0).toUpperCase() + rebuilt.slice(1)
        }
        return rebuilt
      })
    }

    for (const { token, re, keep } of [...FILLER_HEDGES, ...MODAL_HEDGES]) {
      const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
      result = result.replace(global, (match) => {
        const seen = (counters.get(token) || 0) + 1
        counters.set(token, seen)
        if (seen <= keep) return match
        removedByToken[token] = (removedByToken[token] || 0) + 1
        return ''
      })
    }
    return result
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/^\s+/, '')
  })

  const removedCount = Object.values(removedByToken).reduce((a, b) => a + b, 0)
  return { html: out, removedByToken, removedCount }
}

/** Exported for tests — filler keep limit. */
export const HEDGE_FILLER_KEEP_LIMIT = 3

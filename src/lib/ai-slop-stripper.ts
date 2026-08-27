// src/lib/ai-slop-stripper.ts
// Mechanical removal of stock AI transition phrases BEFORE Quality Gate.
//
// The gate already detects these and autofix can remove them on Fix All, but
// generation still ships "In other words," into first-pass Readability
// warnings. Strip at the source so new articles never carry the flag.

import { transformVisibleText } from './typography-normalizer'
import { AI_SLOP_PATTERNS } from './ai-slop-patterns'

export interface AiSlopStripResult {
  html: string
  strippedPhrases: string[]
  strippedCount: number
}

/**
 * Remove AI-slop phrases from visible text. Leaves a clean sentence start
 * when a leading phrase is deleted (capitalizes the next word).
 */
export function stripAiSlopPhrases(html: string): AiSlopStripResult {
  if (!html) return { html, strippedPhrases: [], strippedCount: 0 }

  const strippedPhrases: string[] = []

  const out = transformVisibleText(html, (text) => {
    let result = text
    for (const pattern of AI_SLOP_PATTERNS) {
      const global = new RegExp(
        pattern.source,
        pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
      )
      result = result.replace(global, (match) => {
        strippedPhrases.push(match.trim())
        return ' '
      })
    }
    // Collapse spaces left by deletions, then capitalize sentence starts
    // (including the start of the text node after a leading-phrase wipe).
    result = result.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim()
    result = result.replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead: string, ch: string) => `${lead}${ch.toUpperCase()}`)
    return result
  })

  return {
    html: out,
    strippedPhrases,
    strippedCount: strippedPhrases.length,
  }
}

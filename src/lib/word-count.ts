/** Pure word-count helpers — safe for client and server (no LLM SDK). */

/** Presets: Medium 1500 (skip 1200 — too thin for outline+FAQ+schema), then long-form. */
export const WORD_COUNT_OPTIONS = [1500, 2000, 2500, 3000] as const
export type WordCountOption = (typeof WORD_COUNT_OPTIONS)[number]

export function snapWordCount(n: number): WordCountOption {
  if (n >= 2750) return 3000
  if (n >= 2250) return 2500
  if (n >= 1750) return 2000
  return 1500
}

/** Prose word count — strips scripts/styles/comments so schema JSON-LD never inflates the number. */
export function countArticleWords(html: string): number {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

export function wordCountBand(target: number): { min: number; max: number } {
  // Jasper-style soft band: aim near target, accept ~±12% (not a hard SEO factor)
  return {
    min: Math.round(target * 0.88),
    max: Math.round(target * 1.12),
  }
}

/** Hard ceiling: over soft max triggers a condense pass. */
export function exceedsWordCountTarget(html: string, target: number): boolean {
  return countArticleWords(html) > wordCountBand(target).max
}

/** Structure budget so outlines don't ask for 2× the target length. */
export function structureBudgetForWordCount(target: number): {
  h2Count: number
  faqCount: number
  parasPerH2: number
  wordsPerH2: number
} {
  if (target <= 1600) return { h2Count: 5, faqCount: 4, parasPerH2: 2, wordsPerH2: 160 }
  if (target <= 2200) return { h2Count: 6, faqCount: 5, parasPerH2: 3, wordsPerH2: 200 }
  if (target <= 2700) return { h2Count: 7, faqCount: 5, parasPerH2: 3, wordsPerH2: 220 }
  return { h2Count: 7, faqCount: 6, parasPerH2: 3, wordsPerH2: 250 }
}

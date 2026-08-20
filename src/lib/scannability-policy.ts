/**
 * Shared scannability policy — ONE threshold set for validator, fixer, and
 * paragraph-splitter. Do not invent per-file thresholds.
 *
 * Dense paragraph (≥ denseSentenceThreshold sentences) → eligible for
 * auto-split and counted toward the Quality Gate warning.
 * After split, chunks target ≤ targetMaxSentencesPerParagraph.
 */

export const SCANNABILITY_POLICY = {
  /** Sentence count at which a body <p> is considered dense. */
  denseSentenceThreshold: 6,
  /** Max sentences per paragraph after a mechanical split. */
  targetMaxSentencesPerParagraph: 3,
  /** Word-count overflow also triggers a split (paragraph-splitter). */
  maxWordsPerParagraph: 90,
  /** Emit a scannability warning when this many dense paragraphs remain. */
  minDenseParagraphsForWarning: 4,
} as const

export type ScannabilityPolicy = typeof SCANNABILITY_POLICY

/** Skip auto-split / dense counting for byline / meta / verified lines. */
export const SCANNABILITY_META_PARAGRAPH_RE =
  /\bclass=["'][^"']*(?:article-meta|article-byline|article-dateline|article-last-verified)[^"']*["']/i

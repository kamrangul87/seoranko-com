// src/lib/scannability-enforcer.ts
// Detect → repair → RE-VALIDATE loop for dense paragraphs.
//
// The splitters (scannability-fixer / paragraph-splitter) were already wired
// into the pipeline, but nothing verified their output: any paragraph shape
// they could not break (e.g. <br>-separated sentences, which carry no
// whitespace sentence boundary) silently survived every pass and still
// counted as dense in structure-validator, so the Quality Gate kept
// reporting the same scannability warning. This module runs the mechanical
// repairs until the validator itself agrees, and reports what is left when
// it cannot — never "assume the splitter worked".

import { autoSplitDenseParagraphs } from './scannability-fixer'
import { splitDenseParagraphs, splitParagraphsAtLineBreaks } from './paragraph-splitter'
import { SCANNABILITY_META_PARAGRAPH_RE, SCANNABILITY_POLICY } from './scannability-policy'
import { countSentences } from './sentence-boundaries'

const MAX_PASSES = 4

/** Body paragraphs still at/above the dense threshold (validator's own rule). */
export function findDenseParagraphs(html: string): string[] {
  const dense: string[] = []
  for (const p of html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || []) {
    if (SCANNABILITY_META_PARAGRAPH_RE.test(p)) continue
    const plainText = p.replace(/<[^>]+>/g, '')
    if (countSentences(plainText) >= SCANNABILITY_POLICY.denseSentenceThreshold) {
      dense.push(plainText.replace(/\s+/g, ' ').trim())
    }
  }
  return dense
}

export interface ScannabilityEnforcementResult {
  html: string
  /** Paragraphs that are still dense after every mechanical repair pass. */
  remainingDenseParagraphs: string[]
  /** Set only when the remaining count would trigger the QG warning. */
  error?: string
}

export function enforceScannability(html: string): ScannabilityEnforcementResult {
  let current = splitParagraphsAtLineBreaks(html)

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (findDenseParagraphs(current).length === 0) break
    const next = splitDenseParagraphs(autoSplitDenseParagraphs(current))
    if (next === current) break
    current = next
  }

  const remainingDenseParagraphs = findDenseParagraphs(current)
  const error =
    remainingDenseParagraphs.length >= SCANNABILITY_POLICY.minDenseParagraphsForWarning
      ? `Scannability post-condition failed: ${remainingDenseParagraphs.length} paragraph(s) are still ${SCANNABILITY_POLICY.denseSentenceThreshold}+ sentences after mechanical splitting. First: "${remainingDenseParagraphs[0].slice(0, 120)}"`
      : undefined

  return { html: current, remainingDenseParagraphs, error }
}

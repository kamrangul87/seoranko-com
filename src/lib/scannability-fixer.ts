// src/lib/scannability-fixer.ts
// Mechanically splits any paragraph at/above SCANNABILITY_POLICY.denseSentenceThreshold
// so structure-validator and readers never see a dense block. Sentence counting
// MUST go through sentence-boundaries.ts (same as the validator).

import { countSentences, sentenceBoundaryOffsets } from './sentence-boundaries'
import {
  SCANNABILITY_POLICY,
  SCANNABILITY_META_PARAGRAPH_RE,
} from './scannability-policy'
import { splitParagraphsAtLineBreaks } from './paragraph-splitter'

function splitDenseParagraphOnce(articleHtml: string): string {
  const { denseSentenceThreshold } = SCANNABILITY_POLICY
  return articleHtml.replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (match, attrs, innerHtml) => {
    if (SCANNABILITY_META_PARAGRAPH_RE.test(match)) return match

    const plainText = innerHtml.replace(/<[^>]+>/g, ' ')
    const sentenceCount = countSentences(plainText)
    if (sentenceCount < denseSentenceThreshold) return match

    // Domain-safe end offsets (same helper as paragraph-splitter). Append
    // string length so the final sentence is included in the midpoint split.
    const sentenceEnds = [...sentenceBoundaryOffsets(innerHtml), innerHtml.length]
    if (sentenceEnds.length < denseSentenceThreshold) return match

    const midpoint = Math.ceil(sentenceEnds.length / 2)
    const splitAt = sentenceEnds[midpoint - 1]
    const firstHalf = innerHtml.slice(0, splitAt).trim()
    const secondHalf = innerHtml.slice(splitAt).trim()
    if (!firstHalf || !secondHalf) return match

    return `<p${attrs}>${firstHalf}</p>\n<p${attrs}>${secondHalf}</p>`
  })
}

export function autoSplitDenseParagraphs(articleHtml: string): string {
  // <br>-separated sentences carry no whitespace boundary for the offset
  // splitter to break at — promote them to paragraphs first.
  let result = splitParagraphsAtLineBreaks(articleHtml)
  for (let i = 0; i < 8; i++) {
    const next = splitDenseParagraphOnce(result)
    if (next === result) break
    result = next
  }
  return result
}

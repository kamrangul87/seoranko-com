// src/lib/scannability-fixer.ts
// A prompt instruction alone isn't a guarantee the model follows it — same
// lesson as merge-artifact-repair.ts. This mechanically splits any
// paragraph over 6 sentences at its midpoint sentence boundary, so
// structure-validator.ts's scannability check (and readers) never see a
// dense block regardless of whether the write prompt's SCANNABILITY RULE
// was actually followed.
//
// Sentence counting/splitting MUST go through sentence-boundaries.ts so
// domain-like tokens (gov.uk, energynetworks.org) never inflate counts or
// create false split points — same contract as structure-validator.

import { countSentences, sentenceBoundaryOffsets } from './sentence-boundaries'

const META_PARAGRAPH_RE =
  /\bclass=["'][^"']*(?:article-meta|article-byline|article-dateline|article-last-verified)[^"']*["']/i

function splitDenseParagraphOnce(articleHtml: string): string {
  return articleHtml.replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (match, attrs, innerHtml) => {
    if (META_PARAGRAPH_RE.test(match)) return match

    const plainText = innerHtml.replace(/<[^>]+>/g, ' ')
    const sentenceCount = countSentences(plainText)
    if (sentenceCount < 6) return match

    // Domain-safe end offsets (same helper as paragraph-splitter). Append
    // string length so the final sentence is included in the midpoint split.
    const sentenceEnds = [...sentenceBoundaryOffsets(innerHtml), innerHtml.length]
    if (sentenceEnds.length < 6) return match

    const midpoint = Math.ceil(sentenceEnds.length / 2)
    const splitAt = sentenceEnds[midpoint - 1]
    const firstHalf = innerHtml.slice(0, splitAt).trim()
    const secondHalf = innerHtml.slice(splitAt).trim()
    if (!firstHalf || !secondHalf) return match

    return `<p${attrs}>${firstHalf}</p>\n<p${attrs}>${secondHalf}</p>`
  })
}

export function autoSplitDenseParagraphs(articleHtml: string): string {
  let result = articleHtml
  for (let i = 0; i < 8; i++) {
    const next = splitDenseParagraphOnce(result)
    if (next === result) break
    result = next
  }
  return result
}

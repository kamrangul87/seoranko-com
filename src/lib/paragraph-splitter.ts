// src/lib/paragraph-splitter.ts
// Mechanical scannability safety net on the final artifact: splits body <p>
// tags that meet SCANNABILITY_POLICY.denseSentenceThreshold (or the word
// budget) into chunks of at most targetMaxSentencesPerParagraph.
//
// Same sentence-boundary implementation as structure-validator /
// scannability-fixer — never a local /[.!?]/ counter.

import { parse } from 'node-html-parser'
import { countSentences, sentenceBoundaryOffsets } from './sentence-boundaries'
import {
  SCANNABILITY_POLICY,
  SCANNABILITY_META_PARAGRAPH_RE,
} from './scannability-policy'

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

// Splits `innerHtml` (the raw contents of one <p>) into multiple HTML
// chunks, each within the sentence/word budget, breaking only at sentence
// boundaries found in the plain-text projection. Inline tags (<a>, <strong>,
// etc.) are preserved verbatim by operating on the same string offsets the
// boundary detector used — safe here because paragraphs in this pipeline
// don't nest block-level markup, only inline formatting/links.
function splitParagraphHtml(innerHtml: string): string[] {
  const {
    denseSentenceThreshold,
    targetMaxSentencesPerParagraph,
    maxWordsPerParagraph,
  } = SCANNABILITY_POLICY

  const boundaries = sentenceBoundaryOffsets(innerHtml)
  // sentenceBoundaryOffsets() only reports the N-1 punctuation marks BETWEEN
  // sentences. Appending innerHtml.length turns that into one END POSITION
  // PER SENTENCE — sentenceEnds.length === countSentences for the same text.
  const sentenceEnds = [...boundaries, innerHtml.length]
  const sentenceCount = sentenceEnds.length
  // Prefer the shared counter so validator/fixer/splitter never diverge.
  const counted = countSentences(innerHtml)
  const effectiveCount = Math.max(sentenceCount, counted)

  const wordCount = countWords(innerHtml.replace(/<[^>]+>/g, ' '))
  const needsSplit =
    effectiveCount >= denseSentenceThreshold || wordCount > maxWordsPerParagraph

  if (!needsSplit) {
    return [innerHtml]
  }
  // Only one detectable sentence (or none) — nothing safe to split at.
  if (effectiveCount <= 1 || sentenceEnds.length <= 1) return [innerHtml]

  // Group into chunks of at most targetMaxSentencesPerParagraph.
  const chunks: string[] = []
  let chunkStart = 0
  for (let i = 0; i < sentenceEnds.length; i++) {
    const isGroupEnd =
      (i + 1) % targetMaxSentencesPerParagraph === 0 ||
      i === sentenceEnds.length - 1
    if (!isGroupEnd) continue
    const end = sentenceEnds[i]
    const chunk = innerHtml.slice(chunkStart, end).trim()
    if (chunk) chunks.push(chunk)
    chunkStart = end
  }

  return chunks.length > 1 ? chunks : [innerHtml]
}

export function splitDenseParagraphs(html: string): string {
  if (!html) return html
  const root = parse(html)
  const paragraphs = root.querySelectorAll('p')

  for (const p of paragraphs) {
    const outer = p.toString()
    if (SCANNABILITY_META_PARAGRAPH_RE.test(outer)) continue
    const parts = splitParagraphHtml(p.innerHTML)
    if (parts.length <= 1) continue
    const replacementHtml = parts.map(part => `<p>${part}</p>`).join('\n')
    p.replaceWith(replacementHtml)
  }

  return root.toString()
}

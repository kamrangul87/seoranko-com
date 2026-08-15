// src/lib/paragraph-splitter.ts
// Mechanical scannability safety net: splits any <p> that's grown too long
// (too many sentences or too many words) into multiple <p> tags at the
// nearest sentence boundary. Deterministic, no model call — the write
// prompt's own scannability rule is a request, not a guarantee (same lesson
// as scannability-fixer.ts's autoSplitDenseParagraphs, which this
// complements: that one reacts to sentence COUNT only and runs earlier in
// the pipeline; this one also considers word count and runs after image
// injection, right before save, so it's the last mechanical pass on the
// final HTML shape).

import { parse } from 'node-html-parser'
import { maskDomainLikeTokens } from './article-quality-gate'

const MAX_SENTENCES_PER_PARAGRAPH = 4
const MAX_WORDS_PER_PARAGRAPH = 90

// Splits on sentence-ending punctuation followed by whitespace + a capital
// letter/quote — same boundary heuristic used elsewhere in this codebase
// (fact-checker.ts's splitIntoSentences). Domain-like tokens are masked
// first (not stripped — length-preserving) purely to stop a sentence
// boundary being misdetected inside a masked run; splitting always happens
// against the ORIGINAL text, using the same character offsets.
function sentenceBoundaries(text: string): number[] {
  const masked = maskDomainLikeTokens(text)
  const boundaries: number[] = []
  const re = /[.!?]+(?=\s+[A-Z"'‘“])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(masked)) !== null) {
    boundaries.push(m.index + m[0].length)
  }
  return boundaries
}

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
  const boundaries = sentenceBoundaries(innerHtml)
  // sentenceBoundaries() only reports the N-1 punctuation marks BETWEEN
  // sentences (the final sentence in a paragraph has no trailing
  // punctuation-then-capital-letter after it to match against, since
  // there's nothing left in the string). Appending innerHtml.length turns
  // that into one END POSITION PER SENTENCE — sentenceEnds.length is the
  // true sentence count. A prior version compared boundaries.length
  // directly against MAX_SENTENCES_PER_PARAGRAPH, silently tolerating one
  // extra sentence per paragraph (a 5-sentence paragraph read as only 4)
  // and, when the boundary count landed on an exact multiple of MAX, an
  // "is this the last boundary" special case swallowed the intended split
  // point entirely — the two compounding off-by-one bugs meant paragraphs
  // never actually split in practice.
  const sentenceEnds = [...boundaries, innerHtml.length]
  const sentenceCount = sentenceEnds.length

  const wordCount = countWords(innerHtml.replace(/<[^>]+>/g, ' '))
  if (sentenceCount <= MAX_SENTENCES_PER_PARAGRAPH && wordCount <= MAX_WORDS_PER_PARAGRAPH) {
    return [innerHtml]
  }
  // Only one detectable sentence (or none at all — a run-on with no
  // punctuation boundary) — nothing safe to split at.
  if (sentenceCount <= 1) return [innerHtml]

  // Group sentences into chunks of at most MAX_SENTENCES_PER_PARAGRAPH each
  // — a simple, deterministic split; word-count overflow on an individual
  // sentence-heavy chunk is accepted rather than breaking mid-sentence.
  const chunks: string[] = []
  let chunkStart = 0
  for (let i = 0; i < sentenceEnds.length; i++) {
    const isGroupEnd = (i + 1) % MAX_SENTENCES_PER_PARAGRAPH === 0 || i === sentenceEnds.length - 1
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
    const parts = splitParagraphHtml(p.innerHTML)
    if (parts.length <= 1) continue
    const replacementHtml = parts.map(part => `<p>${part}</p>`).join('\n')
    p.replaceWith(replacementHtml)
  }

  return root.toString()
}

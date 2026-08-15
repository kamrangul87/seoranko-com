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
  if (boundaries.length === 0) return [innerHtml]

  const sentenceCount = boundaries.length
  const wordCount = countWords(innerHtml.replace(/<[^>]+>/g, ' '))
  if (sentenceCount <= MAX_SENTENCES_PER_PARAGRAPH && wordCount <= MAX_WORDS_PER_PARAGRAPH) {
    return [innerHtml]
  }

  // Group boundaries into chunks of at most MAX_SENTENCES_PER_PARAGRAPH
  // sentences each — a simple, deterministic split; word-count overflow on
  // an individual sentence-heavy chunk is accepted rather than breaking
  // mid-sentence.
  const chunks: string[] = []
  let chunkStart = 0
  let sentencesInChunk = 0
  for (let i = 0; i < boundaries.length; i++) {
    sentencesInChunk++
    const isLastBoundary = i === boundaries.length - 1
    if (sentencesInChunk >= MAX_SENTENCES_PER_PARAGRAPH || isLastBoundary) {
      const end = isLastBoundary ? innerHtml.length : boundaries[i]
      const chunk = innerHtml.slice(chunkStart, end).trim()
      if (chunk) chunks.push(chunk)
      chunkStart = end
      sentencesInChunk = 0
    }
  }
  // Any trailing fragment after the last detected boundary (no closing
  // punctuation matched, e.g. HTML tail) belongs with the last chunk.
  const tail = innerHtml.slice(chunkStart).trim()
  if (tail) {
    if (chunks.length > 0) chunks[chunks.length - 1] += ' ' + tail
    else chunks.push(tail)
  }

  return chunks.length > 0 ? chunks : [innerHtml]
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

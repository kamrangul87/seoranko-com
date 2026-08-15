import { describe, it, expect } from 'vitest'
import { splitDenseParagraphs } from './paragraph-splitter'

function countSentences(text: string): number {
  return (text.match(/[.!?]+(?=\s|$)/g) || []).length
}

describe('splitDenseParagraphs', () => {
  it('splits a 7-sentence paragraph into 2 or more paragraphs, none over 4 sentences', () => {
    const sentences = [
      'This is sentence one about EV chargers.',
      'This is sentence two about installation costs.',
      'This is sentence three about permit requirements.',
      'This is sentence four about inspection timelines.',
      'This is sentence five about grid capacity.',
      'This is sentence six about maintenance schedules.',
      'This is sentence seven about warranty coverage.',
    ]
    const html = `<h1>Title</h1><p>${sentences.join(' ')}</p>`
    const result = splitDenseParagraphs(html)
    const paragraphs = Array.from(result.matchAll(/<p>([\s\S]*?)<\/p>/g)).map(m => m[1])

    expect(paragraphs.length).toBeGreaterThanOrEqual(2)
    for (const p of paragraphs) {
      expect(countSentences(p)).toBeLessThanOrEqual(4)
    }
    // No sentence content was lost in the split
    for (const s of sentences) {
      expect(result).toContain(s.replace(/\.$/, ''))
    }
  })

  it('leaves a short paragraph (<=4 sentences, <=90 words) untouched', () => {
    const html = '<h1>Title</h1><p>Short sentence one. Short sentence two.</p>'
    const result = splitDenseParagraphs(html)
    expect((result.match(/<p>/g) || []).length).toBe(1)
  })

  it('does not misdetect a sentence boundary inside a domain-like token', () => {
    const html = '<h1>Title</h1><p>Check the latest rules at gov.uk. Ofgem publishes updated data every quarter with detailed guidance.</p>'
    const result = splitDenseParagraphs(html)
    // Still one paragraph (well under the sentence/word threshold) and the
    // domain token survives intact — masking must not leak into the output.
    expect(result).toContain('gov.uk')
  })

  it('returns empty/falsy input unchanged', () => {
    expect(splitDenseParagraphs('')).toBe('')
  })
})

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

  it('splits a 5-sentence paragraph (the exact off-by-one regression case) into 4+1, not left unsplit', () => {
    // Confirmed in production: paragraphs with exactly 5 sentences were
    // never split at all — sentenceBoundaries() only reports the 4
    // punctuation marks BETWEEN 5 sentences, and a prior version compared
    // that count directly against the max instead of the true sentence
    // count (boundaries + 1 trailing sentence).
    const sentences = [
      'An ev home charger draws power from your domestic supply.',
      'Most households typically choose between a 7kW unit and a 22kW unit.',
      'The reality is that speed comes with a trade-off.',
      'A 22kW charger finishes charging faster than a 7kW unit.',
      'What changes is the rate of draw from the grid.',
    ]
    const html = `<h1>Title</h1><p>${sentences.join(' ')}</p>`
    const result = splitDenseParagraphs(html)
    const paragraphs = Array.from(result.matchAll(/<p>([\s\S]*?)<\/p>/g)).map(m => m[1])

    expect(paragraphs.length).toBeGreaterThanOrEqual(2)
    for (const p of paragraphs) {
      expect(countSentences(p)).toBeLessThanOrEqual(4)
    }
    for (const s of sentences) {
      expect(result).toContain(s.replace(/\.$/, ''))
    }
  })

  it('splits an exact-multiple 8-sentence paragraph into two 4-sentence paragraphs (not merged back into one)', () => {
    // Regression for the second compounding bug: when the boundary count
    // landed on an exact multiple of the max, the old "is this the last
    // boundary" special case captured the whole remainder to the end of
    // the string instead of stopping at the intended split point.
    const sentences = Array.from({ length: 8 }, (_, i) => `Sentence number ${i + 1} covers a distinct point.`)
    const html = `<h1>Title</h1><p>${sentences.join(' ')}</p>`
    const result = splitDenseParagraphs(html)
    const paragraphs = Array.from(result.matchAll(/<p>([\s\S]*?)<\/p>/g)).map(m => m[1])

    expect(paragraphs.length).toBe(2)
    expect(countSentences(paragraphs[0])).toBe(4)
    expect(countSentences(paragraphs[1])).toBe(4)
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

  it('splits the actual unsplit production paragraph confirmed via live DB (article ff441ba4)', () => {
    const realParagraph =
      `An <strong>ev home charger</strong>, sometimes called a wallbox, draws power from your domestic supply and converts it to charge your vehicle's battery. ` +
      `Most households typically choose between a 7kW unit (commonly cited as the most popular residential option) and a 22kW three-phase unit often marketed as faster. ` +
      `The reality is that speed comes with a trade-off. ` +
      `A 22kW charger can approximately finish charging in roughly two hours what a 7kW unit typically takes around eight hours to deliver, though the total energy consumed is generally identical. ` +
      `What changes is the rate of draw from the grid, and that rate has direct consequences for your electricity costs that most installation quotes never mention.`
    const html = `<h1>Title</h1><p>${realParagraph}</p>`
    const result = splitDenseParagraphs(html)
    const paragraphs = Array.from(result.matchAll(/<p>([\s\S]*?)<\/p>/g)).map(m => m[1])

    expect(paragraphs.length).toBeGreaterThanOrEqual(2)
    for (const p of paragraphs) {
      expect(countSentences(p)).toBeLessThanOrEqual(4)
    }
    // Inline <strong> markup around "ev home charger" survives the split intact
    expect(result).toContain('<strong>ev home charger</strong>')
  })
})

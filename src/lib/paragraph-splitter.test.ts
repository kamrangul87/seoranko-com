import { describe, it, expect } from 'vitest'
import { splitDenseParagraphs } from './paragraph-splitter'
import { countSentences } from './sentence-boundaries'
import { SCANNABILITY_POLICY } from './scannability-policy'

const { denseSentenceThreshold, targetMaxSentencesPerParagraph } = SCANNABILITY_POLICY

describe('splitDenseParagraphs (shared scannability policy)', () => {
  it(`splits a ${denseSentenceThreshold}+ sentence paragraph into chunks ≤ ${targetMaxSentencesPerParagraph} sentences`, () => {
    const sentences = Array.from(
      { length: denseSentenceThreshold + 1 },
      (_, i) => `This is sentence ${i + 1} about EV chargers and installation.`,
    )
    const html = `<h1>Title</h1><p>${sentences.join(' ')}</p>`
    const result = splitDenseParagraphs(html)
    const paragraphs = Array.from(result.matchAll(/<p>([\s\S]*?)<\/p>/g)).map(m => m[1])

    expect(paragraphs.length).toBeGreaterThanOrEqual(2)
    for (const p of paragraphs) {
      expect(countSentences(p)).toBeLessThanOrEqual(targetMaxSentencesPerParagraph)
    }
    for (const s of sentences) {
      expect(result).toContain(s.replace(/\.$/, ''))
    }
  })

  it(`leaves a ${denseSentenceThreshold - 1}-sentence paragraph under the dense threshold unsplit (when under word budget)`, () => {
    const sentences = Array.from(
      { length: denseSentenceThreshold - 1 },
      (_, i) => `Short point ${i + 1}.`,
    )
    const html = `<h1>Title</h1><p>${sentences.join(' ')}</p>`
    const result = splitDenseParagraphs(html)
    expect((result.match(/<p>/g) || []).length).toBe(1)
  })

  it('splits an exact-multiple dense paragraph cleanly', () => {
    const n = denseSentenceThreshold // 6 → two chunks of 3
    const sentences = Array.from({ length: n }, (_, i) => `Sentence number ${i + 1} covers a distinct point.`)
    const html = `<h1>Title</h1><p>${sentences.join(' ')}</p>`
    const result = splitDenseParagraphs(html)
    const paragraphs = Array.from(result.matchAll(/<p>([\s\S]*?)<\/p>/g)).map(m => m[1])

    expect(paragraphs.length).toBe(n / targetMaxSentencesPerParagraph)
    for (const p of paragraphs) {
      expect(countSentences(p)).toBe(targetMaxSentencesPerParagraph)
    }
  })

  it('leaves a short paragraph untouched', () => {
    const html = '<h1>Title</h1><p>Short sentence one. Short sentence two.</p>'
    const result = splitDenseParagraphs(html)
    expect((result.match(/<p>/g) || []).length).toBe(1)
  })

  it('does not misdetect a sentence boundary inside a domain-like token', () => {
    const html = '<h1>Title</h1><p>Check the latest rules at gov.uk. Ofgem publishes updated data every quarter with detailed guidance.</p>'
    const result = splitDenseParagraphs(html)
    expect(result).toContain('gov.uk')
  })

  it('does not inflate sentence count on energynetworks.org / gov.uk', () => {
    const html =
      `<h1>Title</h1><p>` +
      `Confirm the scheme details on gov.uk before you apply. ` +
      `Capacity maps live on energynetworks.org for every DNO region. ` +
      `Your installer still has to notify the network under G99. ` +
      `Get that assessment in writing before any deposit is paid.` +
      `</p>`
    const result = splitDenseParagraphs(html)
    const paragraphs = Array.from(result.matchAll(/<p>([\s\S]*?)<\/p>/g)).map(m => m[1])
    expect(paragraphs).toHaveLength(1)
    expect(result).toContain('gov.uk')
    expect(result).toContain('energynetworks.org')
  })

  it('returns empty/falsy input unchanged', () => {
    expect(splitDenseParagraphs('')).toBe('')
  })

  it('splits the production paragraph (article ff441ba4) when over word/sentence budget', () => {
    const realParagraph =
      `An <strong>ev home charger</strong>, sometimes called a wallbox, draws power from your domestic supply and converts it to charge your vehicle's battery. ` +
      `Most households typically choose between a 7kW unit (commonly cited as the most popular residential option) and a 22kW three-phase unit often marketed as faster. ` +
      `The reality is that speed comes with a trade-off. ` +
      `A 22kW charger can approximately finish charging in roughly two hours what a 7kW unit typically takes around eight hours to deliver, though the total energy consumed is generally identical. ` +
      `What changes is the rate of draw from the grid, and that rate has direct consequences for your electricity costs that most installation quotes never mention.`
    const html = `<h1>Title</h1><p>${realParagraph}</p>`
    const wordCount = realParagraph.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
    const result = splitDenseParagraphs(html)
    const paragraphs = Array.from(result.matchAll(/<p>([\s\S]*?)<\/p>/g)).map(m => m[1])

    // 5 sentences — under denseSentenceThreshold — but over maxWordsPerParagraph.
    expect(countSentences(realParagraph)).toBeLessThan(denseSentenceThreshold)
    expect(wordCount).toBeGreaterThan(SCANNABILITY_POLICY.maxWordsPerParagraph)
    expect(paragraphs.length).toBeGreaterThanOrEqual(2)
    expect(result).toContain('<strong>ev home charger</strong>')
  })
})

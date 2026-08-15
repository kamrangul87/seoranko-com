import { describe, it, expect } from 'vitest'
import {
  countArticleWords,
  structureBudgetForWordCount,
  deterministicTrimToTarget,
  exceedsWordCountTarget,
  wordCountBand,
  snapWordCount,
} from './word-count-enforcer'
import { parseFAQsFromArticle } from './faq-generator'

describe('word-count-enforcer', () => {
  it('snaps to 1500 / 2000 / 2500 / 3000 (no 1200)', () => {
    expect(snapWordCount(1200)).toBe(1500)
    expect(snapWordCount(1500)).toBe(1500)
    expect(snapWordCount(1800)).toBe(2000)
    expect(snapWordCount(2000)).toBe(2000)
    expect(snapWordCount(2600)).toBe(2500)
    expect(snapWordCount(3100)).toBe(3000)
  })

  it('uses ±12% soft band', () => {
    expect(wordCountBand(2000)).toEqual({ min: 1760, max: 2240 })
    expect(wordCountBand(1500)).toEqual({ min: 1320, max: 1680 })
  })

  it('scales structure for 1500 and 2000 words', () => {
    expect(structureBudgetForWordCount(1500).h2Count).toBe(5)
    const b = structureBudgetForWordCount(2000)
    expect(b.h2Count).toBe(6)
    expect(b.faqCount).toBe(5)
    expect(b.parasPerH2).toBe(3)
  })

  it('strips scripts from word count so schema does not inflate UI', () => {
    const html = '<h1>Title</h1><p>one two three four five</p><script type="application/ld+json">{"a":"b c d e f g h i j k"}</script>'
    expect(countArticleWords(html)).toBe(6) // Title + 5 words
  })

  it('deterministically trims oversized articles within ±12% band', () => {
    const sections = Array.from({ length: 14 }, (_, i) =>
      `<h2>Section ${i + 1}</h2><p>${'word '.repeat(120)}</p><p>${'more '.repeat(120)}</p>`
    ).join('')
    const html = `<h1>EV Charger Guide</h1><p>${'intro '.repeat(80)}</p>${sections}<h2>FAQ</h2><p>${'faq '.repeat(60)}</p><h2>Bottom Line</h2><p>${'end '.repeat(40)}</p>`
    expect(exceedsWordCountTarget(html, 2000)).toBe(true)
    const trimmed = deterministicTrimToTarget(html, 2000)
    expect(countArticleWords(trimmed)).toBeLessThanOrEqual(wordCountBand(2000).max)
    expect(trimmed).toMatch(/FAQ/i)
    expect(trimmed).toMatch(/Bottom Line/i)
  })
})

describe('parseFAQsFromArticle bare h3', () => {
  it('parses FAQ H2 with bare h3/p pairs', () => {
    const html = `
      <h1>EV Charger</h1>
      <h2>FAQ</h2>
      <h3>What is an EV charger?</h3>
      <p>It is a device that supplies electricity to charge an electric vehicle at home or in public.</p>
      <h3>How much does installation cost?</h3>
      <p>Home installation typically costs several hundred pounds depending on your fuse board and driveway layout.</p>
      <h2>Bottom Line</h2>
      <p>Choose carefully.</p>
    `
    const { faqs } = parseFAQsFromArticle(html)
    expect(faqs.length).toBeGreaterThanOrEqual(2)
    expect(faqs[0].question).toMatch(/EV charger/i)
  })
})

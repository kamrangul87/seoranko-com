import { describe, it, expect } from 'vitest'
import {
  countArticleWords,
  structureBudgetForWordCount,
  deterministicTrimToTarget,
  exceedsWordCountTarget,
} from './word-count-enforcer'
import { parseFAQsFromArticle } from './faq-generator'

describe('word-count-enforcer', () => {
  it('scales structure for 1200 words', () => {
    const b = structureBudgetForWordCount(1200)
    expect(b.h2Count).toBe(5)
    expect(b.faqCount).toBe(4)
    expect(b.parasPerH2).toBe(2)
  })

  it('strips scripts from word count', () => {
    const html = '<h1>Title</h1><p>one two three four five</p><script type="application/ld+json">{"a":"b c d e f g h i j k"}</script>'
    expect(countArticleWords(html)).toBe(6) // Title + 5 words
  })

  it('deterministically trims oversized articles', () => {
    const sections = Array.from({ length: 8 }, (_, i) =>
      `<h2>Section ${i + 1}</h2><p>${'word '.repeat(80)}</p><p>${'more '.repeat(80)}</p>`
    ).join('')
    const html = `<h1>EV Charger Guide</h1><p>${'intro '.repeat(40)}</p>${sections}<h2>FAQ</h2><p>${'faq '.repeat(40)}</p><h2>Bottom Line</h2><p>${'end '.repeat(30)}</p>`
    expect(exceedsWordCountTarget(html, 1200)).toBe(true)
    const trimmed = deterministicTrimToTarget(html, 1200)
    expect(countArticleWords(trimmed)).toBeLessThanOrEqual(Math.ceil(1200 * 1.08))
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

import { describe, it, expect } from 'vitest'
import { validateArticleStructure } from './structure-validator'

describe('structure-validator scannability (Phase 3 domain-safe counting)', () => {
  it('does not inflate sentence counts on gov.uk / energynetworks.org citations', () => {
    // Four short paragraphs each with one real sentence + domain tokens.
    // Naive /[.!?]+/ would count domains as extra sentences and could trip
    // the 6+ threshold incorrectly if stacked; domain-safe counting must not.
    const paras = Array.from({ length: 4 }, (_, i) =>
      `<p>Paragraph ${i + 1} cites gov.uk and energynetworks.org for the rule.</p>`,
    ).join('\n')
    const html = `<h1>Guide</h1>${paras}`
    const issues = validateArticleStructure(html)
    expect(issues.filter(i => i.category === 'scannability')).toHaveLength(0)
  })

  it('still flags genuinely dense paragraphs (6+ real sentences)', () => {
    const dense = `<p>${Array.from({ length: 6 }, (_, i) => `Sentence number ${i + 1} is here.`).join(' ')}</p>`
    const html = `<h1>Guide</h1>${dense}${dense}${dense}${dense}`
    const issues = validateArticleStructure(html)
    const scan = issues.filter(i => i.category === 'scannability')
    expect(scan.length).toBe(1)
    expect(scan[0].message).toMatch(/4 paragraphs are 6\+ sentences/)
  })
})

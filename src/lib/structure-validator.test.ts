import { describe, it, expect } from 'vitest'
import { validateArticleStructure } from './structure-validator'
import { SCANNABILITY_POLICY } from './scannability-policy'

const { denseSentenceThreshold, minDenseParagraphsForWarning } = SCANNABILITY_POLICY

describe('structure-validator scannability (shared policy)', () => {
  it('does not inflate sentence counts on gov.uk / energynetworks.org citations', () => {
    const paras = Array.from({ length: 4 }, (_, i) =>
      `<p>Paragraph ${i + 1} cites gov.uk and energynetworks.org for the rule.</p>`,
    ).join('\n')
    const html = `<h1>Guide</h1>${paras}`
    const issues = validateArticleStructure(html)
    expect(issues.filter(i => i.category === 'scannability')).toHaveLength(0)
  })

  it('still flags genuinely dense paragraphs', () => {
    const dense = `<p>${Array.from({ length: denseSentenceThreshold }, (_, i) => `Sentence number ${i + 1} is here.`).join(' ')}</p>`
    const html = `<h1>Guide</h1>${dense}${dense}${dense}${dense}`
    const issues = validateArticleStructure(html)
    const scan = issues.filter(i => i.category === 'scannability')
    expect(scan.length).toBe(1)
    expect(scan[0].message).toMatch(
      new RegExp(`${minDenseParagraphsForWarning} paragraphs are ${denseSentenceThreshold}\\+ sentences`),
    )
  })
})

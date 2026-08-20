import { describe, it, expect } from 'vitest'
import { autoSplitDenseParagraphs } from './scannability-fixer'
import { countSentences } from './sentence-boundaries'
import { SCANNABILITY_POLICY } from './scannability-policy'

const { denseSentenceThreshold } = SCANNABILITY_POLICY

describe('autoSplitDenseParagraphs (shared policy)', () => {
  it(`splits a genuinely dense ${denseSentenceThreshold}+ sentence paragraph`, () => {
    const sentences = Array.from(
      { length: denseSentenceThreshold },
      (_, i) => `Sentence number ${i + 1} covers a distinct point about charging.`,
    )
    const html = `<p>${sentences.join(' ')}</p>`
    const result = autoSplitDenseParagraphs(html)
    const paras = Array.from(result.matchAll(/<p>([\s\S]*?)<\/p>/g)).map(m => m[1])
    expect(paras.length).toBeGreaterThanOrEqual(2)
    for (const p of paras) {
      expect(countSentences(p)).toBeLessThan(denseSentenceThreshold)
    }
    for (const s of sentences) {
      expect(result).toContain(s.replace(/\.$/, ''))
    }
  })

  it('does not treat gov.uk / energynetworks.org as extra sentences', () => {
    const html =
      `<p>` +
      `Check the latest rules at gov.uk before you book. ` +
      `Ofgem and energynetworks.org publish capacity maps each quarter. ` +
      `Your DNO still decides the final headroom figure. ` +
      `A pre-application assessment is usually free or low-cost. ` +
      `Ask every installer what happens if reinforcement is required.` +
      `</p>`
    const result = autoSplitDenseParagraphs(html)
    expect((result.match(/<p[\s>]/g) || []).length).toBe(1)
    expect(result).toContain('gov.uk')
    expect(result).toContain('energynetworks.org')
    expect(countSentences(html.replace(/<[^>]+>/g, ' '))).toBe(5)
  })

  it('still splits when domains appear inside a truly dense paragraph', () => {
    const sentences = [
      'Visit gov.uk for grant eligibility before you pay a deposit.',
      'Energynetworks.org helps you identify your DNO region quickly.',
      'A service head upgrade can add hundreds to the final quote.',
      'Network reinforcement is rarer but far more expensive.',
      'Always get the DNO figure in writing before signing.',
      'Compare at least three itemised installer quotes afterwards.',
    ]
    const html = `<p>${sentences.join(' ')}</p>`
    const result = autoSplitDenseParagraphs(html)
    expect((result.match(/<p[\s>]/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(result).toContain('gov.uk')
    expect(result).toContain('Energynetworks.org')
  })

  it('leaves meta / byline paragraphs untouched', () => {
    const dense = Array.from({ length: denseSentenceThreshold }, (_, i) => `Meta sentence ${i + 1}.`).join(' ')
    const html = `<p class="article-last-verified">${dense}</p>`
    expect(autoSplitDenseParagraphs(html)).toBe(html)
  })
})

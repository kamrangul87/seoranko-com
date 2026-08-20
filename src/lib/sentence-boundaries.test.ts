import { describe, it, expect } from 'vitest'
import {
  maskDomainLikeTokens,
  maskNonSentencePeriods,
  countSentences,
  splitSentences,
  sentenceBoundaryOffsets,
} from './sentence-boundaries'

describe('maskDomainLikeTokens', () => {
  it('masks gov.uk and energynetworks.org without changing length', () => {
    const text = 'See gov.uk and energynetworks.org for details.'
    const masked = maskDomainLikeTokens(text)
    expect(masked.length).toBe(text.length)
    expect(masked).not.toContain('gov.uk')
    expect(masked).not.toContain('energynetworks.org')
    expect(masked).toContain('details')
  })

  it('preserves letter case so capital-led domains still look like sentence starts', () => {
    const text = 'Done. Energynetworks.org has the map.'
    const masked = maskDomainLikeTokens(text)
    expect(masked.length).toBe(text.length)
    const afterPeriod = masked.slice(text.indexOf('.') + 1).trimStart()
    expect(afterPeriod[0]).toBe('X')
  })
})

describe('countSentences / splitSentences', () => {
  it('does not inflate counts on domain-like tokens', () => {
    const withDomains =
      'Check guidance on gov.uk and energynetworks.org before installing.'
    expect(countSentences(withDomains)).toBe(1)
  })

  it('counts real sentence terminals via splitSentences', () => {
    expect(countSentences('One. Two! Three?')).toBe(3)
    expect(splitSentences('One. Two! Three?')).toHaveLength(3)
  })

  it('does not count decimal points as sentence boundaries', () => {
    expect(countSentences('The unit delivers 7.4kW continuously.')).toBe(1)
    expect(countSentences('The charger can deliver 7.4kW. That is different from 22kW.')).toBe(2)
  })

  it('does not count URL path dots as sentence boundaries', () => {
    expect(
      countSentences('See https://example.com/a.b/c for the chart before buying.'),
    ).toBe(1)
  })
})

describe('sentenceBoundaryOffsets', () => {
  it('returns offsets after non-sentence period masking', () => {
    const text = 'Visit gov.uk today. Then call support.'
    const offsets = sentenceBoundaryOffsets(text)
    expect(offsets.length).toBe(1)
    expect(text.slice(0, offsets[0])).toContain('today.')
  })

  it('still finds a boundary when the next sentence starts with a domain', () => {
    const text =
      'Visit gov.uk for grant eligibility before you pay a deposit. Energynetworks.org helps you identify your DNO region quickly.'
    const offsets = sentenceBoundaryOffsets(text)
    expect(offsets.length).toBe(1)
    expect(text.slice(offsets[0]).trimStart().startsWith('Energynetworks.org')).toBe(true)
  })

  it('maskNonSentencePeriods is length-preserving', () => {
    const text = 'Pay 7.4 at https://gov.uk/pay now.'
    expect(maskNonSentencePeriods(text).length).toBe(text.length)
  })
})

describe('NOT an insertion-corruption detector', () => {
  it('does not flag the live "speeds. and 150 kW" splice as a boundary problem', () => {
    const literal =
      'though most UK EVs currently accept between 50 kW and lower speeds. and 150 kW.'
    // Lowercase "and" after the period → no boundary offset (integrity handles corruption).
    expect(sentenceBoundaryOffsets(literal)).toEqual([])
    // Trailing content still counts as one plain sentence blob + the orphan clause
    // via append-length split — count is 1 because no capital-led boundary.
    expect(countSentences(literal)).toBe(1)
  })
})

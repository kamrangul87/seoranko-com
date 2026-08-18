import { describe, it, expect } from 'vitest'
import {
  maskDomainLikeTokens,
  countSentences,
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
})

describe('countSentences', () => {
  it('does not inflate counts on domain-like tokens', () => {
    const withDomains =
      'Check guidance on gov.uk and energynetworks.org before installing.'
    expect(countSentences(withDomains)).toBe(1)
  })

  it('counts real sentence terminals', () => {
    expect(countSentences('One. Two! Three?')).toBe(3)
  })
})

describe('sentenceBoundaryOffsets', () => {
  it('returns offsets after domain masking', () => {
    const text = 'Visit gov.uk today. Then call support.'
    const offsets = sentenceBoundaryOffsets(text)
    expect(offsets.length).toBe(1)
    expect(text.slice(0, offsets[0])).toContain('today.')
  })
})

describe('NOT an insertion-corruption detector', () => {
  // Confirmed against the live splice:
  // "though most UK EVs currently accept between 50 kW and lower speeds. and 150 kW."
  // sentence-boundaries only masks domains + counts/splits sentences. It does
  // not detect mid-clause fragment splices. That belongs to sentence-integrity
  // (hasInsertionCorruption) — already covered there with this exact string.
  it('does not flag the live "speeds. and 150 kW" splice as a boundary problem', () => {
    const literal =
      'though most UK EVs currently accept between 50 kW and lower speeds. and 150 kW.'
    // countSentences uses /[.!?]+/g — sees TWO punctuation runs, not "corruption"
    expect(countSentences(literal)).toBe(2)
    // sentenceBoundaryOffsets requires capital after the period — "and" is
    // lowercase, so this splice yields ZERO split offsets (same blind spot
    // that made the old sentence-count integrity check miss it).
    expect(sentenceBoundaryOffsets(literal)).toEqual([])
  })
})

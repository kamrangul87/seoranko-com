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

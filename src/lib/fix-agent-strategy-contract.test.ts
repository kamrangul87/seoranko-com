import { describe, expect, it } from 'vitest'
import { STRATEGY_VERIFICATION_CONTRACTS } from './fix-agent-strategy-contract'
import { AUTO_FIX_KINDS } from './fix-agent-classification'

describe('Fix Agent strategy verification contracts', () => {
  it('covers every AutoFixKind exactly once', () => {
    const kinds = STRATEGY_VERIFICATION_CONTRACTS.map((c) => c.kind).sort()
    const expected = [...AUTO_FIX_KINDS].sort()
    expect(kinds).toEqual(expected)
  })

  it('requires dedicated live fetch for llms-txt and security-headers', () => {
    const llms = STRATEGY_VERIFICATION_CONTRACTS.find((c) => c.kind === 'llms-txt')
    const headers = STRATEGY_VERIFICATION_CONTRACTS.find((c) => c.kind === 'security-headers')
    expect(llms?.requiresDedicatedLiveFetch).toBe(true)
    expect(headers?.requiresDedicatedLiveFetch).toBe(true)
    expect(llms?.mechanicalAssertion).toMatch(/verifyLlmsTxtLive/)
    expect(headers?.mechanicalAssertion).toMatch(/verifySecurityHeadersLive/)
  })

  it('every contract names before/after extractors and failure handoff', () => {
    for (const c of STRATEGY_VERIFICATION_CONTRACTS) {
      expect(c.beforeStateExtractor.length).toBeGreaterThan(5)
      expect(c.liveAfterStateExtractor.length).toBeGreaterThan(5)
      expect(c.mechanicalAssertion.length).toBeGreaterThan(5)
      expect(c.rollbackOrHandoff.length).toBeGreaterThan(5)
    }
  })
})

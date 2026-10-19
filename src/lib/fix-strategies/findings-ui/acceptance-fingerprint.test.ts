import { describe, expect, it } from 'vitest'
import { findingAcceptanceFingerprint } from './acceptance-fingerprint'

describe('findingAcceptanceFingerprint', () => {
  it('is stable for the same observation', () => {
    const a = findingAcceptanceFingerprint({
      detail: 'Primary entity url mismatch',
      pageUrl: 'https://autodun.com/privacy',
      evidenceValues: { left: 'https://autodun.com/', right: 'https://autodun.com/privacy' },
    })
    const b = findingAcceptanceFingerprint({
      detail: 'Primary entity url mismatch',
      pageUrl: 'https://autodun.com/privacy',
      evidenceValues: { left: 'https://autodun.com/', right: 'https://autodun.com/privacy' },
    })
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes when the page observation changes', () => {
    const before = findingAcceptanceFingerprint({
      detail: 'old detail',
      pageUrl: 'https://example.com/a',
      evidenceValues: { left: '1', right: '2' },
    })
    const after = findingAcceptanceFingerprint({
      detail: 'new detail',
      pageUrl: 'https://example.com/a',
      evidenceValues: { left: '1', right: '2' },
    })
    expect(before).not.toBe(after)
  })
})

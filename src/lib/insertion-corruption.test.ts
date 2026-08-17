import { describe, it, expect } from 'vitest'
import { applyDeterministicMergeFixes, detectMergeArtifacts } from './merge-artifact-repair'
import { scrubInsertionCorruption, hasInsertionCorruption } from './sentence-integrity'
import { applyGuardedRegexReplace } from './sentence-integrity'

describe('production corruption shapes', () => {
  it('scrubs verify-at-GOV.UK .350. duplication', () => {
    const bad = `<p>Drivers may receive grants of up to £350 (verify at GOV.UK).350. The EVHS scheme covers eligible wallboxes.</p>`
    expect(hasInsertionCorruption(bad)).toBe(true)
    const { html, fixes } = scrubInsertionCorruption(bad)
    expect(fixes).toBeGreaterThan(0)
    expect(html).toBe(
      `<p>Drivers may receive grants of up to £350 (verify at GOV.UK). The EVHS scheme covers eligible wallboxes.</p>`
    )
    expect(hasInsertionCorruption(html)).toBe(false)
  })

  it('detects require.ehicles as a merge artifact', () => {
    const bad = `<p>That is something newer electric vehicles require.ehicles need a dedicated circuit.</p>`
    expect(hasInsertionCorruption(bad)).toBe(true)
    const artifacts = detectMergeArtifacts(bad)
    expect(artifacts.some(a => a.matchedText.includes('require.ehicles'))).toBe(true)
  })

  it('deterministic merge fixes scrub insertion corruption', () => {
    const bad = `<p>Up to £350 (verify at GOV.UK).350. Next sentence.</p>`
    const { content, fixesMade } = applyDeterministicMergeFixes(bad)
    expect(fixesMade).toBeGreaterThan(0)
    expect(content).not.toMatch(/\)\.350\./)
  })

  it('guarded grant hedge does not leave corruption', () => {
    const html = `<p>You can get grants of up to £350 toward a home charger.</p>`
    const { html: out, appliedCount } = applyGuardedRegexReplace(
      html,
      /\bup to (£\d+)\b(?!\s*\(verify at GOV\.UK\))/gi,
      (m) => `${m} (verify at GOV.UK)`,
      'grant',
    )
    expect(appliedCount).toBe(1)
    expect(out).toContain('(verify at GOV.UK)')
    expect(hasInsertionCorruption(out)).toBe(false)
  })
})

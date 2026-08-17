import { describe, it, expect } from 'vitest'
import {
  splitIntoSentences,
  hasInsertionCorruption,
  isSafeTextPatch,
  applyGuardedReplace,
  applyGuardedRegexReplace,
  scrubInsertionCorruption,
} from './sentence-integrity'

describe('sentence-integrity', () => {
  it('detects require.ehicles-style corruption', () => {
    expect(hasInsertionCorruption('newer electric vehicles require.ehicles need.')).toBe(true)
  })

  it('detects duplicated figure after verify parenthetical', () => {
    const bad = 'grants of up to £350 (verify at GOV.UK).350. The EVHS scheme'
    expect(hasInsertionCorruption(bad)).toBe(true)
  })

  it('rejects patches that add a new sentence', () => {
    const original = 'Costs averaging around £3,200, with some reaching £5,000 or more.'
    const broken = 'Costs averaging around £3,200, with some reaching higher amounts. £5,000 or more.'
    expect(isSafeTextPatch(original, broken)).toBe(false)
  })

  it('accepts a clean hedge that stays one sentence', () => {
    const original = 'Home chargers cost £800.'
    const hedged = 'Home chargers typically cost around £800.'
    expect(isSafeTextPatch(original, hedged)).toBe(true)
  })

  it('applyGuardedReplace keeps original when replacement corrupts', () => {
    const html = '<p>grants of up to £350. The EVHS scheme helps.</p>'
    const { html: out, applied } = applyGuardedReplace(
      html,
      'up to £350',
      'up to £350 (verify at GOV.UK).350',
      'test',
    )
    expect(applied).toBe(false)
    expect(out).toBe(html)
  })

  it('applyGuardedRegexReplace applies safe grant hedges', () => {
    const html = '<p>Drivers can get grants of up to £350 toward installation.</p>'
    const { html: out, appliedCount } = applyGuardedRegexReplace(
      html,
      /\bup to (£\d+)\b(?!\s*\(verify at GOV\.UK\))/gi,
      (match) => `${match} (verify at GOV.UK)`,
      'grant',
    )
    expect(appliedCount).toBe(1)
    expect(out).toContain('(verify at GOV.UK)')
    expect(hasInsertionCorruption(out)).toBe(false)
  })

  it('scrubInsertionCorruption fixes .350. after verify paren', () => {
    const bad = '<p>grants of up to £350 (verify at GOV.UK).350. The EVHS scheme helps.</p>'
    const { html, fixes } = scrubInsertionCorruption(bad)
    expect(fixes).toBeGreaterThan(0)
    expect(html).toContain('(verify at GOV.UK).')
    expect(html).not.toMatch(/\)\.350\./)
    expect(splitIntoSentences(html.replace(/<[^>]+>/g, ' ')).length).toBeGreaterThanOrEqual(1)
  })
})

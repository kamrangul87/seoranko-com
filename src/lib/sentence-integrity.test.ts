import { describe, it, expect } from 'vitest'
import {
  splitIntoSentences,
  hasInsertionCorruption,
  hasOverlappingPhraseCorruption,
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

  // Confirmed live (article da83d673): a fact-sourcing hedge patch turned
  // "...accept between 50 kW and 150 kW." into "...accept between 50 kW
  // and lower speeds. and 150 kW." — a fragment spliced mid-clause. Neither
  // the old corruption-pattern list nor the sentence-count check caught it,
  // because splitIntoSentences only counts a new sentence when the period
  // is followed by a CAPITAL letter, and "and" here is lowercase.
  it('detects the exact "50 kW and lower speeds. and 150 kW." splice shape', () => {
    const corrupted = 'though most UK EVs currently accept between 50 kW and lower speeds. and 150 kW.'
    expect(hasInsertionCorruption(corrupted)).toBe(true)
  })

  it('rejects the exact fact-checker hedge patch that produced the live bug', () => {
    const original = 'though most UK EVs currently accept between 50 kW and 150 kW.'
    const patched = 'though most UK EVs currently accept between 50 kW and lower speeds. and 150 kW.'
    // The old bug: sentence count was equal both before and after (the
    // splitter never saw "and" as a new sentence), so this used to pass.
    expect(splitIntoSentences(original).length).toBe(splitIntoSentences(patched).length)
    expect(isSafeTextPatch(original, patched)).toBe(false)
  })

  it('does not false-positive on legitimate abbreviations followed by lowercase text', () => {
    expect(hasInsertionCorruption('Costs vary by region, e.g. urban areas pay more.')).toBe(false)
    expect(hasInsertionCorruption('Installation takes approx. two hours on average.')).toBe(false)
  })

  it('still accepts a genuinely clean hedge patch after the new pattern was added', () => {
    const original = 'Most UK EVs accept between 50 kW and 150 kW.'
    const hedged = 'Most UK EVs typically accept between around 50 kW and 150 kW.'
    expect(isSafeTextPatch(original, hedged)).toBe(true)
  })

  // Live 2026-08-18 article-v2: duplicated/overlapping phrases with NO mid-word
  // punctuation — a different corruption class than require.ehicles / .350.
  it('detects "scope of work infrastructure work" overlapping phrase merge', () => {
    const literal =
      'total costs frequently appear to reach approximately £1,500 to £5,000 or more depending on the scope of work infrastructure work needed.'
    expect(hasInsertionCorruption(literal)).toBe(true)
    expect(hasOverlappingPhraseCorruption(literal)).toBe(true)
  })

  it('detects "charger installation. EV charger installation" cross-sentence duplicate', () => {
    const literal =
      'the entire unit may potentially need replacing as a safety condition for home charger installation. EV charger installation, adding £300 to £700 to your project.'
    expect(hasInsertionCorruption(literal)).toBe(true)
    expect(hasOverlappingPhraseCorruption(literal)).toBe(true)
  })

  it('scrubs both live overlapping-phrase shapes', () => {
    const html = `<p>depending on the scope of work infrastructure work needed.</p>
<p>as a safety condition for home charger installation. EV charger installation, adding £300 to £700 to your project.</p>`
    const { html: out, fixes } = scrubInsertionCorruption(html)
    expect(fixes).toBeGreaterThan(0)
    expect(out).toContain('scope of infrastructure work needed')
    expect(out).not.toMatch(/work infrastructure work/)
    expect(out).toMatch(/home charger installation,\s*adding £300/)
    expect(out).not.toMatch(/installation\.\s*EV charger installation/)
    expect(hasInsertionCorruption(out)).toBe(false)
  })

  it('does not false-positive on legitimate reduplication (more and more / time after time)', () => {
    expect(hasOverlappingPhraseCorruption('Prices get more and more competitive each year.')).toBe(false)
    expect(hasOverlappingPhraseCorruption('Check the unit time after time during the first week.')).toBe(false)
    expect(hasOverlappingPhraseCorruption('Follow the guide step by step before ordering.')).toBe(false)
  })

  it('rejects a patch that introduces overlapping phrase corruption', () => {
    const original = 'depending on the infrastructure work needed.'
    const patched = 'depending on the scope of work infrastructure work needed.'
    expect(isSafeTextPatch(original, patched)).toBe(false)
  })
})


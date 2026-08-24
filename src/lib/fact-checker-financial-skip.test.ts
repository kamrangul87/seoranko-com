import { describe, it, expect } from 'vitest'
import {
  checkAndPatchFactSourcing,
  isFinancialNumericClaim,
  isSentenceSourced,
} from './fact-checker'
import { evaluateClaimEvidence } from './claim-evidence'
import { hasInsertionCorruption } from './sentence-integrity'

const GOV_GRANT =
  'https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles'

describe('fact-checker: do not Haiku-patch financial figures', () => {
  it('identifies grant/currency/percent sentences as financial', () => {
    expect(isFinancialNumericClaim('Eligible renters can claim up to £350 toward installation.')).toBe(
      true,
    )
    expect(isFinancialNumericClaim('The labour subsidy is 75% of eligible costs.')).toBe(true)
    expect(isFinancialNumericClaim('A 7 kW unit typically finishes overnight.')).toBe(false)
  })

  it('does not call a hedge patch (patchedCount 0) when only financial figures are unsourced', async () => {
    const html = `
      <p>Eligible renters can claim up to £350 toward charger installation.
      Confirm eligibility on the <a href="${GOV_GRANT}">official grants collection</a>.</p>
      <p>Some quotes still mention a 75% labour subsidy with no source.</p>
    `
    const out = await checkAndPatchFactSourcing(html, 'ev charger', 'UK')
    expect(out.result.patchedCount).toBe(0)
    expect(out.article).toBe(html)
    // Honest score: financial figures not treated as sourced via href-only / hedge
    expect(out.result.factSourcingScore).toBeLessThan(100)
    expect(out.result.flaggedClaims.length).toBeGreaterThan(0)
    expect(hasInsertionCorruption(out.article)).toBe(false)
  })

  it('href-only PARTIAL/UNSUPPORTED grant figure is not counted as sourced', () => {
    const html = `<p>Eligible renters can claim up to £350 toward installation.
      See <a href="${GOV_GRANT}">grants</a>.</p>`
    const ev = evaluateClaimEvidence(html).find((e) => /£350/i.test(e.figureText || ''))
    expect(ev).toBeTruthy()
    if (ev && ev.status !== 'SUPPORTED') {
      const map = new Map([[(ev.figureText || '').toLowerCase(), ev]])
      expect(
        isSentenceSourced('Eligible renters can claim up to £350 toward installation.', html, {
          claimEvidenceByFigure: map,
        }),
      ).toBe(false)
    }
  })
})

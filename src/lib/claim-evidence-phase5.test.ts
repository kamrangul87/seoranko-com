/**
 * Phase 5 — claim-level evidence model.
 *
 * One document-level citation is not proof of every claim.
 * Restating the same claim without repeating the link is fine.
 */

import { describe, it, expect } from 'vitest'
import {
  evaluateClaimEvidence,
  applyLiveSourceEvidence,
  formatClaimEvidenceDescription,
  severityForClaimEvidence,
  claimIdentityKey,
} from './claim-evidence'
import {
  evaluateGrantFigureClaims,
  evaluateClaimEvidenceIssues,
  getClaimEvidenceForArticle,
} from './article-quality-gate'
import { GRANT_FIGURE_CITATION_POLICY } from './quality-gate-policy'

const GOV_GRANT =
  'https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles'
const GOV_TAX = 'https://www.gov.uk/vehicle-tax'

describe('Phase 5 claim evidence model', () => {
  it('policy is claim-level-once', () => {
    expect(GRANT_FIGURE_CITATION_POLICY).toBe('claim-level-once')
  })

  it('does not punish restatements of the same figure without repeating the citation', () => {
    const html = `
      <p>The <a href="${GOV_GRANT}">OZEV grant</a> helps eligible renters with up to £350 toward installation.</p>
      <p>Under the same scheme, eligible renters can claim up to £350 toward costs.</p>
    `
    const evidence = evaluateClaimEvidence(html)
    const fig = evidence.find((e) => /£350/i.test(e.figureText || ''))
    expect(fig).toBeTruthy()
    expect(fig!.occurrenceCount).toBe(2)
    expect(['SUPPORTED', 'PARTIALLY_SUPPORTED', 'HISTORICAL']).toContain(fig!.status)
    expect(fig!.rationale).toMatch(/restatement|appears 2 times/i)

    const issues = evaluateGrantFigureClaims(html)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).not.toBe('critical')
  })

  it('does not treat an unrelated official citation as proof of a grant figure', () => {
    const html = `
      <p>Eligible renters can claim up to £350 toward charger installation.</p>
      <p>See also <a href="${GOV_TAX}">vehicle tax</a> rules.</p>
    `
    const evidence = evaluateClaimEvidence(html)
    const fig = evidence.find((e) => /£350/i.test(e.figureText || ''))
    expect(fig).toBeTruthy()
    expect(fig!.status).toBe('UNSUPPORTED')
    expect(fig!.source).toBeNull()

    const issues = evaluateGrantFigureClaims(html)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('critical')
    expect(issues[0].description).toMatch(/Claim status: UNSUPPORTED/)
  })

  it('supports a figure when the citation context actually mentions it', () => {
    const html = `
      <p>Eligible businesses can claim up to £500 towards chargepoint hardware via the
      <a href="${GOV_GRANT}">GOV.UK low-emission vehicle grants</a> collection.</p>
    `
    const evidence = evaluateClaimEvidence(html)
    const fig = evidence.find((e) => /£500/i.test(e.figureText || ''))
    expect(fig).toBeTruthy()
    expect(fig!.status).toBe('SUPPORTED')
    expect(fig!.source?.url).toBe(GOV_GRANT)
    expect(fig!.source?.authority).toBe('official')
    expect(fig!.source?.supportingPassage).toMatch(/£500/)
    expect(severityForClaimEvidence(fig!.status)).toBeNull()
  })

  it('does not let a citation for figure A clear an unsupported figure B', () => {
    const html = `
      <p>The <a href="${GOV_GRANT}">workplace charging grant</a> offers up to £500 toward hardware.</p>
      <p>Separately, the installation subsidy rate is 75% of labour costs for flats.</p>
    `
    const evidence = evaluateClaimEvidence(html)
    const five = evidence.find((e) => /£500/i.test(e.figureText || ''))
    const pct = evidence.find((e) => /75%/i.test(e.figureText || ''))
    expect(five).toBeTruthy()
    expect(pct).toBeTruthy()
    expect(['SUPPORTED', 'PARTIALLY_SUPPORTED']).toContain(five!.status)
    expect(pct!.status).toBe('UNSUPPORTED')

    const issues = evaluateGrantFigureClaims(html)
    const unsupported = issues.filter((i) => i.severity === 'critical')
    expect(unsupported.some((i) => /75%/.test(i.figureText || ''))).toBe(true)
  })

  it('formats claim → source → date → authority → passage → status', () => {
    const html = `
      <p>Up to £500 is available via
      <a href="${GOV_GRANT}">GOV.UK grants</a> for workplaces.</p>
    `
    let ev = evaluateClaimEvidence(html).find((e) => /£500/i.test(e.figureText || ''))!
    ev = applyLiveSourceEvidence(ev, {
      sourceDate: '2026-04-01',
      supportingPassage: 'Workplace charging scheme: up to £500',
      figureFound: true,
    })
    const desc = formatClaimEvidenceDescription(ev)
    expect(desc).toMatch(/Claim:/)
    expect(desc).toMatch(/Source:/)
    expect(desc).toMatch(/Source date: 2026-04-01/)
    expect(desc).toMatch(/Source authority: official/)
    expect(desc).toMatch(/Supporting passage:/)
    expect(desc).toMatch(/Claim status: SUPPORTED/)
  })

  it('marks contradicted / outdated from live evidence without hard-coded figures', () => {
    const html = `<p>The grant is currently up to £350 for renters.</p>`
    let ev = evaluateClaimEvidence(html).find((e) => /£350/i.test(e.figureText || ''))!
    expect(ev.status).toBe('UNSUPPORTED')
    ev = applyLiveSourceEvidence(ev, {
      sourceUrl: GOV_GRANT,
      sourceDate: '1 April 2026',
      supportingPassage: 'Current maximum: £500',
      contradicted: true,
      outdated: true,
    })
    expect(ev.status).toBe('CONTRADICTED')
    expect(severityForClaimEvidence(ev.status)).toBe('critical')
  })

  it('claim identity groups restatements of the same figure', () => {
    const a = {
      figureText: 'up to £350',
      claimKind: 'grant' as const,
      claimText: 'Eligible renters can claim up to £350.',
    }
    const b = {
      figureText: 'up to £350',
      claimKind: 'grant' as const,
      claimText: 'The scheme still offers up to £350 toward costs.',
    }
    expect(claimIdentityKey(a)).toBe(claimIdentityKey(b))
  })

  it('getClaimEvidenceForArticle matches evaluateClaimEvidence', () => {
    const html = `<p>Up to £500 via <a href="${GOV_GRANT}">grants</a>.</p>`
    expect(getClaimEvidenceForArticle(html)).toEqual(evaluateClaimEvidence(html))
  })

  it('evaluateClaimEvidenceIssues skips pure financial figures (handled by grant-figure)', () => {
    const html = `<p>Landlords must notify the DNO before installing a charger under local rules.</p>`
    const issues = evaluateClaimEvidenceIssues(html)
    // May be empty or non-grant policy claims — financial-only articles produce none here
    expect(issues.every((i) => i.category === 'claim-evidence')).toBe(true)
    expect(issues.every((i) => !/[£$€]/.test(i.figureText || ''))).toBe(true)
  })
})

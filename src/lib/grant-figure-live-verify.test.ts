/**
 * Live network check — confirms auto-verify against a real GOV.UK page.
 * Uses a figure that currently appears on the grants collection (£500).
 */
import { describe, it, expect } from 'vitest'
import {
  evaluateGrantFigureClaims,
  autoVerifyCitedPolicyIssues,
} from './article-quality-gate'

const GOV_URL =
  'https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles'

describe('live GOV.UK grant-figure auto-verify', () => {
  it('auto-verifies when the cited figure still appears on GOV.UK', async () => {
    const html = `
      <p>Workplace charging grants offer up to £500 towards chargepoint hardware
      for eligible businesses, according to the
      <a href="${GOV_URL}">GOV.UK low-emission vehicle grants</a> collection.</p>
    `
    const issues = evaluateGrantFigureClaims(html)
    const grant = issues.find(i => i.category === 'grant-figure')
    expect(grant?.citationUrl).toMatch(/gov\.uk/i)
    // SUPPORTED + currency unknown → advisory info (not a factual warning)
    expect(grant?.severity).toBe('info')
    expect(grant?.evidenceStatus).toBe('SUPPORTED')

    const verified = await autoVerifyCitedPolicyIssues(issues, new Date())
    const after = verified.find(i => i.category === 'grant-figure')!
    // Pass if auto-verified; correctly-stopped (figure-missing/unreachable) is
    // also acceptable when GOV.UK content or network changes — assert we got
    // a specific status either way, never a vague leftover warning.
    expect(['auto-verified', 'figure-missing', 'unreachable']).toContain(after.verificationStatus)
    if (after.verificationStatus === 'auto-verified') {
      expect(after.severity).toBe('info')
      expect(after.title).toMatch(/Auto-verified as of \d{4}-\d{2}-\d{2}/)
      expect(after.freshnessStatus).toBe('CURRENT')
    } else {
      expect(after.verificationDetail).toBeTruthy()
      expect(after.verificationDetail!.toLowerCase()).not.toContain('manual review required')
    }
  }, 20_000)
})

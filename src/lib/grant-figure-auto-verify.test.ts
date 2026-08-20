import { describe, it, expect, vi } from 'vitest'
import {
  evaluateGrantFigureClaims,
  autoVerifyCitedPolicyIssues,
} from './article-quality-gate'

describe('grant-figure citation auto-verify', () => {
  const html = `
    <p>The Electric Vehicle Homecharge Scheme offers up to £350 towards the cost of a home charger.
    Confirm the current amount on
    <a href="https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles">GOV.UK EV grants</a>.</p>
  `

  it('attaches the bound GOV.UK citation URL to a sourced grant figure', () => {
    const issues = evaluateGrantFigureClaims(html)
    expect(issues.length).toBeGreaterThan(0)
    const grant = issues.find(i => i.category === 'grant-figure')
    expect(grant).toBeTruthy()
    expect(grant!.severity).toBe('warning')
    expect(grant!.citationUrl).toMatch(/gov\.uk/i)
    expect(grant!.figureText).toMatch(/£350/)
    expect(grant!.location).toBeTruthy()
  })

  it('marks a matching GOV.UK page as auto-verified as of today', async () => {
    const issues = evaluateGrantFigureClaims(html)
    const fetchImpl = vi.fn(async () =>
      new Response('<p>Grant of up to £350 for homeowners installing a chargepoint</p>', { status: 200 }),
    ) as unknown as typeof fetch

    const verified = await autoVerifyCitedPolicyIssues(
      issues,
      new Date('2026-08-20T12:00:00Z'),
      fetchImpl,
    )
    const grant = verified.find(i => i.category === 'grant-figure')!
    expect(grant.verificationStatus).toBe('auto-verified')
    expect(grant.severity).toBe('info')
    expect(grant.title).toMatch(/Auto-verified as of 2026-08-20/)
  })

  it('keeps the flag with a specific reason when the figure is gone', async () => {
    const issues = evaluateGrantFigureClaims(html)
    const fetchImpl = vi.fn(async () =>
      new Response('<p>This grant scheme has ended</p>', { status: 200 }),
    ) as unknown as typeof fetch

    const verified = await autoVerifyCitedPolicyIssues(issues, new Date(), fetchImpl)
    const grant = verified.find(i => i.category === 'grant-figure')!
    expect(grant.verificationStatus).toBe('figure-missing')
    expect(grant.severity).toBe('warning')
    expect(grant.verificationDetail).toMatch(/page no longer shows this figure/)
  })
})

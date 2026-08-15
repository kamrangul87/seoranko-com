import { describe, it, expect } from 'vitest'
import { detectDatedClaims, buildLastVerifiedLine } from './dated-claim-detector'

describe('detectDatedClaims', () => {
  const now = new Date('2026-08-13T00:00:00Z')

  it('flags a dated policy claim with no named source nearby', () => {
    const html = '<p>As of August 2026, the grant covers 75% of installation costs for eligible applicants.</p>'
    const claims = detectDatedClaims(html, now)
    expect(claims.length).toBeGreaterThan(0)
    expect(claims.every(c => !c.hasSource)).toBe(true)
  })

  it('does not flag the same claim when a named source is present', () => {
    const html = '<p>As of August 2026, Ofgem data shows the grant covers 75% of installation costs.</p>'
    const claims = detectDatedClaims(html, now)
    const unsourced = claims.filter(c => !c.hasSource)
    expect(unsourced.length).toBe(0)
  })

  it('does not flag the same claim when a hyperlink is present', () => {
    const html = '<p>As of August 2026, the grant covers <a href="https://gov.uk/grants">75% of installation costs</a>.</p>'
    const claims = detectDatedClaims(html, now)
    const unsourced = claims.filter(c => !c.hasSource)
    expect(unsourced.length).toBe(0)
  })

  it('does not flag a dated sentence with no quantitative/policy figure at all', () => {
    const html = '<p>The charger was installed in August 2026 at a residential property.</p>'
    const claims = detectDatedClaims(html, now)
    expect(claims.length).toBe(0)
  })

  it('does not flag a policy figure with no temporal expression', () => {
    const html = '<p>The grant covers 75% of installation costs for eligible applicants.</p>'
    const claims = detectDatedClaims(html, now)
    expect(claims.length).toBe(0)
  })

  it('sets a reviewBy date in the future relative to now', () => {
    const html = '<p>As of August 2026, the grant covers 75% of installation costs.</p>'
    const claims = detectDatedClaims(html, now)
    expect(claims.length).toBeGreaterThan(0)
    expect(new Date(claims[0].reviewBy).getTime()).toBeGreaterThan(now.getTime())
  })
})

describe('buildLastVerifiedLine', () => {
  it('renders a visible line containing a formatted date', () => {
    const line = buildLastVerifiedLine('2026-08-13T00:00:00Z')
    expect(line).toContain('Last verified:')
    expect(line).toContain('2026')
  })
})

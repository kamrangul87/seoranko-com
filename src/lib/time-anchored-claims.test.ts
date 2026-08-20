import { describe, it, expect } from 'vitest'
import { detectTimeAnchoredClaims } from './dated-claim-detector'
import { validateTimeAnchoredClaims, buildDatedPolicyIssues, buildTimeAnchoredClaimRecords } from './article-quality-gate'

const now = new Date('2026-08-13T00:00:00Z')

describe('validateTimeAnchoredClaims', () => {
  it('fails a claim with no outbound citation bound to it anywhere in the article', () => {
    const html = '<p>Currently, the grant covers 75% of installation costs for eligible applicants.</p>'
    const claims = detectTimeAnchoredClaims(html, now)
    const failures = validateTimeAnchoredClaims(html, claims)
    expect(failures.length).toBeGreaterThan(0)
    expect(failures[0].severity).toBe('FAIL')
    expect(failures[0].reasons.some(r => r.includes('no outbound source link'))).toBe(true)
  })

  it('passes a claim bound to a citation elsewhere in the document via shared topic terms', () => {
    const html = `
      <p>The <a href="https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles">OZEV installation grant scheme</a> supports eligible households.</p>
      <p>Currently, the OZEV installation grant scheme covers 75% of costs.</p>
    `
    const claims = detectTimeAnchoredClaims(html, now)
    const failures = validateTimeAnchoredClaims(html, claims)
    expect(failures).toHaveLength(0)
  })

  it('passes a claim with an inline verify hedge nearby', () => {
    const html = '<p>Currently, the grant covers 75% of installation costs (verify at GOV.UK).</p>'
    const claims = detectTimeAnchoredClaims(html, now)
    const failures = validateTimeAnchoredClaims(html, claims)
    expect(failures).toHaveLength(0)
  })

  it('fails a hand-built claim with no reviewBy even if cited', () => {
    const html = '<p>Currently, the grant covers 75% of installation costs (verify at GOV.UK).</p>'
    const claims = detectTimeAnchoredClaims(html, now).map(c => ({ ...c, reviewBy: '' }))
    const failures = validateTimeAnchoredClaims(html, claims)
    expect(failures.length).toBeGreaterThan(0)
    expect(failures[0].reasons).toContain('no review_by date set')
  })
})

describe('buildDatedPolicyIssues + time-anchored claims', () => {
  it('surfaces a critical issue for a relative claim with no date token that chrono cannot catch', () => {
    const html = `
      <h1>EV Charger Grants</h1>
      <p>Currently, the grant covers 75% of installation costs for eligible applicants.</p>
    `
    const issues = buildDatedPolicyIssues(html, { now })
    const critical = issues.filter(i => i.category === 'dated-policy' && i.severity === 'critical')
    expect(critical.length).toBeGreaterThan(0)
  })

  it('does not double-flag a sentence both detectDatedClaims and detectTimeAnchoredClaims would independently catch', () => {
    const html = `
      <h1>EV Charger Grants</h1>
      <p>As of August 2026, the grant covers 75% of installation costs for eligible applicants.</p>
    `
    const issues = buildDatedPolicyIssues(html, { now })
    const dated = issues.filter(i => i.category === 'dated-policy')
    const forThisSentence = dated.filter(i =>
      i.description.includes('As of August 2026, the grant covers 75% of installation costs'),
    )
    expect(forThisSentence).toHaveLength(1)
  })

  it('a cited relative claim produces no dated-policy issue at all', () => {
    const html = `
      <h1>EV Charger Grants</h1>
      <p>The <a href="https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles">OZEV installation grant scheme</a> supports eligible households.</p>
      <p>Currently, the OZEV installation grant scheme covers 75% of costs.</p>
    `
    const issues = buildDatedPolicyIssues(html, { now })
    const dated = issues.filter(i => i.category === 'dated-policy')
    expect(dated).toHaveLength(0)
  })
})

describe('buildTimeAnchoredClaimRecords', () => {
  it('returns an empty array when no time-anchored claims are present', () => {
    const html = '<h1>EV Charger Types</h1><p>Type 2 connectors are standard across the UK.</p>'
    expect(buildTimeAnchoredClaimRecords(html, now)).toEqual([])
  })

  it('records the claim, assertedOn, and reviewBy for each unique detected claim', () => {
    const html = '<p>Currently, the grant covers 75% of installation costs.</p>'
    const records = buildTimeAnchoredClaimRecords(html, now)
    expect(records).toHaveLength(1)
    expect(records[0].claim).toContain('Currently, the grant covers 75%')
    expect(records[0].assertedOn).toBe('2026-08-13')
    expect(records[0].reviewBy).toBe('2027-02-09')
    expect(records[0].sourceUrl).toBeNull()
  })

  it('resolves sourceUrl to the bound citation URL when one is found', () => {
    const html = `
      <p>The <a href="https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles">OZEV installation grant scheme</a> supports eligible households.</p>
      <p>Currently, the OZEV installation grant scheme covers 75% of costs.</p>
    `
    const records = buildTimeAnchoredClaimRecords(html, now)
    expect(records.length).toBeGreaterThan(0)
    expect(records[0].sourceUrl).toBe(
      'https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles',
    )
  })

  it('dedupes identical repeated claim sentences to one record', () => {
    const html = `
      <p>Currently, the grant covers 75% of installation costs.</p>
      <p>Currently, the grant covers 75% of installation costs.</p>
    `
    const records = buildTimeAnchoredClaimRecords(html, now)
    expect(records).toHaveLength(1)
  })
})

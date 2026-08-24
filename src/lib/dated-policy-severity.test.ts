import { describe, it, expect } from 'vitest'
import {
  runQualityGate,
  buildDatedPolicyIssues,
  evaluateGrantFigureClaims,
} from './article-quality-gate'
import { DATED_POLICY_SEVERITY } from './quality-gate-policy'
import { fixAllArticleIssues } from './article-fix-all'

const BASE_OPTS = {
  brand: 'autodun',
  keyword: 'home EV charger installation UK',
  authorName: 'Kamran Gul',
  registeredLinkDomains: ['autodun.com'],
  minWordCount: 50,
  expectOrganizationLogo: false,
}

describe('dated-policy severity unify', () => {
  const now = new Date('2026-08-18T12:00:00Z')
  const datedHtml = `
    <html><head><title>EV Grant Guide 2026 | autodun</title>
    <meta name="description" content="Grant amounts for home chargers in 2026." /></head>
    <body><article>
    <h1>Home EV charger installation UK</h1>
    <p>Written by Kamran Gul of autodun.</p>
    <p>As of August 2026, the grant covers 75% of installation costs for eligible applicants.</p>
    <h2>What to know</h2>
    <p>Home EV charger installation UK depends on your meter and DNO.</p>
    </article></body></html>
  `

  it('buildDatedPolicyIssues uses DATED_POLICY_SEVERITY for every finding', () => {
    const issues = buildDatedPolicyIssues(datedHtml, {
      now,
      title: 'EV Grant Guide 2026 | autodun',
      metaDescription: 'Grant amounts for home chargers in 2026.',
    })
    const dated = issues.filter(i => i.category === 'dated-policy')
    expect(dated.length).toBeGreaterThan(0)
    expect(dated.every(i => i.severity === DATED_POLICY_SEVERITY)).toBe(true)
    expect(dated.every(i => i.severity === 'warning')).toBe(true)
  })

  it('runQualityGate surfaces dated-policy at the same severity without extraIssues', async () => {
    const qr = await runQualityGate(datedHtml, {
      ...BASE_OPTS,
      datedPolicy: {
        now,
        title: 'EV Grant Guide 2026 | autodun',
        metaDescription: 'Grant amounts for home chargers in 2026.',
      },
    })
    const dated = qr.issues.filter(i => i.category === 'dated-policy')
    expect(dated.length).toBeGreaterThan(0)
    expect(dated.every(i => i.severity === 'warning')).toBe(true)
  })

  it('caller-supplied dated-policy extras cannot override gate severity', async () => {
    const qr = await runQualityGate(datedHtml, {
      ...BASE_OPTS,
      datedPolicy: { now },
      extraIssues: [
        {
          id: 'dated-claim-injected',
          severity: 'info',
          category: 'dated-policy',
          title: 'Injected with wrong severity',
          description: 'should be stripped',
          autoFixable: false,
        },
      ],
    })
    expect(qr.issues.some(i => i.id === 'dated-claim-injected')).toBe(false)
    const dated = qr.issues.filter(i => i.category === 'dated-policy')
    expect(dated.every(i => i.severity === 'warning')).toBe(true)
  })

  it('Fix All sees the same dated-policy severity as runQualityGate', async () => {
    const result = await fixAllArticleIssues({
      html: datedHtml,
      keyword: BASE_OPTS.keyword,
      brand: BASE_OPTS.brand,
      authorName: BASE_OPTS.authorName,
      registeredLinkDomains: BASE_OPTS.registeredLinkDomains,
      targetWordCount: 200,
      expectOrganizationLogo: false,
    })
    const beforeDated = result.qualityGateBefore.issues.filter(i => i.category === 'dated-policy')
    const afterDated = result.qualityGateAfter.issues.filter(i => i.category === 'dated-policy')
    expect(beforeDated.length).toBeGreaterThan(0)
    expect(beforeDated.every(i => i.severity === 'warning')).toBe(true)
    // Manual review list includes warnings — dated-policy must appear when present
    const manualDated = result.stillNeedsManualReview.filter(i =>
      beforeDated.some(d => d.id === i.id) || afterDated.some(d => d.id === i.id),
    )
    expect(manualDated.length + afterDated.length).toBeGreaterThan(0)
  })
})

describe('grant-figure document-level-once policy', () => {
  it('emits one critical for the same uncited figure restated twice', () => {
    const html = `
      <p>The OZEV grant helps eligible renters with up to £350 toward installation.</p>
      <p>Under the same scheme, eligible renters can claim up to £350 toward costs.</p>
    `
    const issues = evaluateGrantFigureClaims(html)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('critical')
    expect(issues[0].description).toMatch(/appears 2 times|Occurrences: 2/i)
    expect(issues[0].description).toMatch(/restatement|one citation|Claim status/i)
  })

  it('one GOV.UK citation → SUPPORTED advisory (info), not a factual failure', () => {
    const html = `
      <p>The <a href="https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles">OZEV grant</a> helps eligible renters with up to £350 toward charger installation.</p>
      <p>Eligible renters can claim up to £350 toward installation costs.</p>
    `
    const issues = evaluateGrantFigureClaims(html)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('info')
    expect(issues[0].title).toMatch(/Currentness verification recommended/i)
    expect(issues[0].autoFixable).toBe(false)
    expect(issues[0].blocking).toBe(false)
  })

  it('one verify hedge near any instance clears the figure for the whole article', () => {
    const html = `
      <p>Eligible renters can claim up to £350 (verify at GOV.UK) toward installation.</p>
      <p>The same grant still offers up to £350 toward costs for flat owners.</p>
    `
    const issues = evaluateGrantFigureClaims(html)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('warning')
  })

  it('runQualityGate autofix hedges every restatement but clears one grant issue', async () => {
    const html = `
      <html><head><title>Home EV charger installation UK | autodun</title></head>
      <body><article>
      <h1>Home EV charger installation UK</h1>
      <p>Written by Kamran Gul of autodun. Home EV charger installation UK needs a DNO check.</p>
      <p>The OZEV grant helps eligible renters with up to £350 toward installation.</p>
      <p>Under the scheme, eligible renters can claim up to £350 toward costs.</p>
      <h2>Meter types</h2>
      <p>Home EV charger installation UK also depends on your fuse rating.</p>
      </article></body></html>
    `
    // Pre-gate: exactly one critical for the repeated figure
    const pre = evaluateGrantFigureClaims(html)
    expect(pre).toHaveLength(1)
    expect(pre[0].severity).toBe('critical')

    const qr = await runQualityGate(html, BASE_OPTS)
    expect(qr.issues.filter(i => i.category === 'grant-figure' && i.severity === 'critical')).toHaveLength(0)
    const hedges = qr.articleAfterAutoFix.match(/up to £350 \(verify at GOV\.UK\)/gi)
    expect(hedges?.length).toBe(2)
    expect(qr.autoFixedCount).toBeGreaterThanOrEqual(0)
    // Score must reflect FINAL revalidated issues (Phase 9)
    expect(qr.autoFixConfirmation).toBeTruthy()
    expect(qr.autoFixedCount).toBe(qr.autoFixConfirmation!.confirmedResolved.length)
  })
})

/**
 * Phase 4 — freshness / dated-policy unification (tests A–M).
 *
 * Authoritative figures in fixtures are passed via evidenceProvider only —
 * never hard-coded into production validators.
 */

import { describe, it, expect } from 'vitest'
import {
  classifyClaimType,
  classifyTimeStatus,
  isInstructionalNonFactual,
  severityForFreshnessFinding,
  FRESHNESS_CONTRADICTED_SEVERITY,
  FRESHNESS_REVIEW_SEVERITY,
} from './freshness-policy'
import {
  evaluateFreshness,
  evaluateFreshnessSync,
  freshnessFindingsRequiringIssues,
} from './freshness-evaluator'
import {
  buildDatedPolicyIssues,
  evaluateGrantFigureClaims,
  freshnessCoveredFigureKeys,
  recomputeQualityGateTotals,
  runQualityGate,
} from './article-quality-gate'
import { DATED_POLICY_SEVERITY } from './quality-gate-policy'

const NOW = new Date('2026-08-18T12:00:00Z')

const GOV_GRANT =
  'https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles'

describe('Phase 4 freshness policy — claim classification', () => {
  it('D: "Check the rules now" is instructional / non-factual', () => {
    expect(isInstructionalNonFactual('Check the rules now.')).toBe(true)
    expect(classifyClaimType('Check the rules now.')).toBe('instructional')
    expect(severityForFreshnessFinding({
      timeStatus: 'CURRENT',
      evidenceStatus: 'UNSUPPORTED',
      claimType: 'instructional',
    })).toBeNull()
  })

  it('E: "The rules currently require X" is a current factual claim', () => {
    const s = 'The rules currently require landlords to notify the DNO before installing a charger.'
    expect(isInstructionalNonFactual(s)).toBe(false)
    expect(classifyTimeStatus(s, NOW)).toBe('CURRENT')
    expect(classifyClaimType(s)).not.toBe('instructional')
  })

  it('H: future policy framing is FUTURE, not OUTDATED', () => {
    const s = 'From 1 April 2026, the grant increased to £500 for eligible applicants.'
    expect(classifyTimeStatus(s, NOW)).toBe('FUTURE')
  })

  it('C framing: applications before a date are HISTORICAL', () => {
    const s = 'Applications before 1 April 2026 could receive up to £350.'
    expect(classifyTimeStatus(s, NOW)).toBe('HISTORICAL')
  })
})

describe('Phase 4 freshness evaluator — evidence axes (A–C, F–G)', () => {
  it('A: currently £500 with authoritative support → CURRENT + SUPPORTED → no warning', async () => {
    const html = `<p>The grant is currently £500 for eligible workplaces.</p>`
    const findings = await evaluateFreshness(html, {
      now: NOW,
      evidenceProvider: async () => ({
        sourceUrl: GOV_GRANT,
        sourceUpdatedAt: '1 April 2026',
        currentValueText: '£500',
        supportsCurrent: true,
        amounts: ['£500'],
      }),
    })
    const claim = findings.find(f => /currently £500/i.test(f.sentence))
    expect(claim).toBeTruthy()
    expect(claim!.timeStatus).toBe('CURRENT')
    expect(claim!.evidenceStatus).toBe('SUPPORTED')
    expect(severityForFreshnessFinding(claim!)).toBeNull()
    expect(freshnessFindingsRequiringIssues(findings)).toHaveLength(0)
  })

  it('B: currently £350 when source says £500 → OUTDATED / CONTRADICTED → critical', async () => {
    const html = `<p>The grant is currently £350 for eligible workplaces.</p>`
    const findings = await evaluateFreshness(html, {
      now: NOW,
      evidenceProvider: async () => ({
        sourceUrl: GOV_GRANT,
        sourceUpdatedAt: '1 April 2026',
        currentValueText: '£500',
        supportsCurrent: false,
        amounts: ['£500'],
      }),
    })
    const claim = findings.find(f => /currently £350/i.test(f.sentence))
    expect(claim).toBeTruthy()
    expect(claim!.timeStatus).toBe('OUTDATED')
    expect(claim!.evidenceStatus).toBe('CONTRADICTED')
    expect(severityForFreshnessFinding(claim!)).toBe(FRESHNESS_CONTRADICTED_SEVERITY)
    expect(claim!.evidenceSummary).toMatch(/Current value: £500/)
    expect(claim!.recommendedAction).toMatch(/historical|update/i)
  })

  it('C: historical applications figure with supporting evidence → HISTORICAL + SUPPORTED', async () => {
    const html = `
      <p>Applications before 1 April 2026 could receive up to £350
      (<a href="${GOV_GRANT}">GOV.UK grants</a>).</p>
    `
    const findings = await evaluateFreshness(html, {
      now: NOW,
      evidenceProvider: async () => ({
        sourceUrl: GOV_GRANT,
        supportsHistorical: true,
        amounts: ['£350'],
      }),
    })
    const claim = findings.find(f => /before 1 April 2026/i.test(f.sentence))
    expect(claim).toBeTruthy()
    expect(claim!.timeStatus).toBe('HISTORICAL')
    expect(claim!.evidenceStatus).toBe('SUPPORTED')
    const issues = freshnessFindingsRequiringIssues(findings).filter(
      f => severityForFreshnessFinding(f) === 'warning' || severityForFreshnessFinding(f) === 'critical',
    )
    expect(issues).toHaveLength(0)
  })

  it('F: dated claim with valid official citation does not demand a second citation', () => {
    const html = `
      <p>As of August 2026, the grant covers 75% of costs via the
      <a href="${GOV_GRANT}">low-emission vehicle grants</a> scheme.</p>
    `
    const issues = buildDatedPolicyIssues(html, { now: NOW })
    const datedWarnings = issues.filter(
      i => i.category === 'dated-policy' && (i.severity === 'warning' || i.severity === 'critical'),
    )
    expect(datedWarnings).toHaveLength(0)
  })

  it('G: dated claim with unrelated citation stays unsupported / needs review', () => {
    const html = `
      <p>As of August 2026, the grant covers 75% of installation costs.
      See also <a href="https://www.gov.uk/vehicle-tax">vehicle tax</a>.</p>
    `
    const findings = evaluateFreshnessSync(html, { now: NOW })
    const claim = findings.find(f => /grant covers 75%/i.test(f.sentence))
    expect(claim).toBeTruthy()
    expect(['UNSUPPORTED', 'NEEDS_REVIEW', 'PARTIALLY_SUPPORTED']).toContain(claim!.evidenceStatus)
    expect(severityForFreshnessFinding(claim!)).toBe(FRESHNESS_REVIEW_SEVERITY)
  })
})

describe('Phase 4 relative language & future (D, H, M)', () => {
  it('D/M: instructional relative language produces no dated-policy warning', () => {
    const html = `<p>Check the rules now. Visit the guidance today before you apply.</p>`
    const issues = buildDatedPolicyIssues(html, { now: NOW })
    expect(issues.filter(i => i.category === 'dated-policy')).toHaveLength(0)
  })

  it('H: future statement is not automatically OUTDATED', async () => {
    const html = `<p>From 1 April 2027, the grant will increase to £500.</p>`
    const findings = await evaluateFreshness(html, { now: NOW })
    const claim = findings.find(f => /From 1 April 2027/i.test(f.sentence))
    expect(claim).toBeTruthy()
    expect(claim!.timeStatus).toBe('FUTURE')
    expect(claim!.timeStatus).not.toBe('OUTDATED')
  })
})

describe('Phase 4 dedupe & shared severity (I, J)', () => {
  it('I: same claim yields one canonical dated-policy issue', () => {
    const html = `
      <p>As of August 2026, the grant covers 75% of installation costs for eligible applicants.</p>
    `
    const issues = buildDatedPolicyIssues(html, { now: NOW })
    const dated = issues.filter(i => i.category === 'dated-policy')
    expect(dated).toHaveLength(1)
  })

  it('J: DANGEROUS_FACT_PATTERNS path removed — runQualityGate uses shared severity only', async () => {
    const html = `
      <html><head><title>EV Grant Guide 2026</title>
      <meta name="description" content="Grant amounts in 2026." /></head>
      <body><article>
      <h1>Home EV charger grant</h1>
      <p>Written by Kamran Gul of autodun.</p>
      <p>As of August 2026, the grant scheme covers 75% of installation costs.</p>
      <h2>Details</h2>
      <p>Home EV charger grant depends on your meter type.</p>
      </article></body></html>
    `
    const qr = await runQualityGate(html, {
      brand: 'autodun',
      keyword: 'Home EV charger grant',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['autodun.com'],
      minWordCount: 50,
      expectOrganizationLogo: false,
      datedPolicy: { now: NOW, title: 'EV Grant Guide 2026', metaDescription: 'Grant amounts in 2026.' },
    })
    const dated = qr.issues.filter(i => i.category === 'dated-policy')
    expect(dated.length).toBeGreaterThan(0)
    // Needs-review uses shared warning; no duplicate conflicting severities for same sentence
    const byLoc = new Map<string, string[]>()
    for (const i of dated) {
      const key = (i.location || i.title).slice(0, 80)
      if (!byLoc.has(key)) byLoc.set(key, [])
      byLoc.get(key)!.push(i.severity)
    }
    for (const sevs of Array.from(byLoc.values())) {
      expect(new Set(sevs).size).toBe(1)
    }
    expect(dated.every(i => i.severity === DATED_POLICY_SEVERITY || i.severity === 'info' || i.severity === 'critical')).toBe(true)
  })

  it('freshness-covered figures suppress duplicate grant-figure issues', () => {
    const html = `<p>Currently, the grant is £350 for eligible renters.</p>`
    const covered = freshnessCoveredFigureKeys(html, NOW)
    expect(covered.has('£350')).toBe(true)
    const grantIssues = evaluateGrantFigureClaims(html, covered)
    expect(grantIssues).toHaveLength(0)
  })
})

describe('Phase 4 score + fixtures (K, L)', () => {
  it('K: historical supported claim does not reduce the Quality Gate score', () => {
    const findingIssues = buildDatedPolicyIssues(
      `<p>Before April 2026 the grant was £350
       (<a href="${GOV_GRANT}">GOV.UK grants</a>).</p>`,
      { now: NOW },
    )
    // HISTORICAL + SUPPORTED → info only (or nothing that is warning/critical)
    const penalising = findingIssues.filter(i => i.severity === 'warning' || i.severity === 'critical')
    expect(penalising).toHaveLength(0)

    const totals = recomputeQualityGateTotals({
      issues: findingIssues.map(i => ({ ...i })),
      passed: true,
    } as Parameters<typeof recomputeQualityGateTotals>[0])
    // info does not reduce score from 100
    expect(totals.score).toBe(100)
  })

  it('L: current article fixture detects stale/unsourced current claims', () => {
    const html = `
      <article>
      <p>The workplace charging grant is currently £350 toward hardware costs.</p>
      </article>
    `
    const issues = buildDatedPolicyIssues(html, { now: NOW })
    const dated = issues.filter(i => i.category === 'dated-policy')
    expect(dated.length).toBeGreaterThan(0)
    expect(dated.some(i => i.severity === 'warning' || i.severity === 'critical')).toBe(true)
    expect(dated[0].description).toMatch(/Claim:/)
    expect(dated[0].description).toMatch(/Recommended action:/)
  })

  it('B via Quality Gate issues: contradicted claim description includes evidence', async () => {
    const html = `<p>The grant is currently £350 for eligible workplaces.</p>`
    const findings = await evaluateFreshness(html, {
      now: NOW,
      evidenceProvider: async () => ({
        sourceUrl: GOV_GRANT,
        sourceUpdatedAt: '1 April 2026',
        currentValueText: '£500',
        amounts: ['£500'],
        supportsCurrent: false,
      }),
    })
    const issues = buildDatedPolicyIssues(html, { now: NOW, evidenceFindings: findings })
    const crit = issues.find(i => i.severity === 'critical')
    expect(crit).toBeTruthy()
    expect(crit!.title).toMatch(/outdated/i)
    expect(crit!.description).toMatch(/Current value: £500/)
    expect(crit!.description).toMatch(/Claim:/)
  })
})

describe('Phase 4 real article fixture — government grant figure', () => {
  const realishFixture = `
    <html><head><title>Workplace EV charger grant UK 2026 | autodun</title>
    <meta name="description" content="How the workplace charging grant works in 2026."/></head>
    <body><article>
    <h1>Workplace EV charger grant UK</h1>
    <p>Written by Kamran Gul of autodun.</p>
    <p>Eligible businesses can claim up to £500 towards chargepoint hardware under the
    workplace charging scheme. Confirm the current amount on the
    <a href="${GOV_GRANT}">GOV.UK low-emission vehicle grants</a> collection.</p>
    <p>Applications before 1 April 2024 could receive a lower historical cap — check archived guidance.</p>
    <p>Check the rules now before you submit an application.</p>
    <h2>Eligibility</h2>
    <p>Workplace EV charger grant UK funding depends on parking and ownership rules.</p>
    </article></body></html>
  `

  it('does not warn on instructional "check the rules now"', () => {
    const issues = buildDatedPolicyIssues(realishFixture, {
      now: NOW,
      title: 'Workplace EV charger grant UK 2026 | autodun',
      metaDescription: 'How the workplace charging grant works in 2026.',
    })
    expect(issues.every(i => !/check the rules now/i.test(i.description + i.title))).toBe(true)
  })

  it('historical applications sentence is not treated as a current-policy error', () => {
    const findings = evaluateFreshnessSync(realishFixture, { now: NOW })
    const hist = findings.filter(f => /Applications before/i.test(f.sentence))
    for (const f of hist) {
      expect(f.timeStatus).toBe('HISTORICAL')
      expect(severityForFreshnessFinding(f)).not.toBe('critical')
    }
  })
})

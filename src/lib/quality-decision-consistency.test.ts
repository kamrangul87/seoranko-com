/**
 * Phase 5 — decision / severity / dimension consistency.
 *
 * Acceptance: one authoritative mapping (decideClaimIssue + buildExplainableScore),
 * titles match state, Fact Sourcing consumes claim-evidence, one final score,
 * publish reason names actual blockers, 0 confirmed fixes ≠ fake decimal score.
 */

import { describe, it, expect } from 'vitest'
import {
  decideClaimIssue,
  defaultFreshnessForEvidence,
  formatFixAllScoreSummary,
} from './quality-decision-policy'
import {
  evaluateClaimEvidence,
  applyLiveSourceEvidence,
  severityForClaimEvidence,
} from './claim-evidence'
import {
  evaluateGrantFigureClaims,
  recomputeQualityGateTotals,
} from './article-quality-gate'
import { buildExplainableScore } from './quality-score-dimensions'
import { scoreFromIssues } from './autofix-confirmation'
import { isSentenceSourced } from './fact-checker'

const GOV_GRANT =
  'https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles'

/** Real contradictory UI case: PARTIAL grant + soft title + Freshness PASS illusion. */
const REAL_PARTIAL_FIXTURE = `
<html><head><title>Home EV charger grant | BrandCo</title>
<meta name="description" content="Grant amounts for home chargers." /></head>
<body><article>
<h1>Home EV charger installation guide</h1>
<p>Written by Alex Writer of BrandCo.</p>
<p>Eligible renters can claim up to £350 toward charger installation costs under the
current scheme. Confirm eligibility on the
<a href="${GOV_GRANT}">official low-emission vehicle grants collection</a>.</p>
<p>Separately, some landlords quote a 75% labour subsidy for flats with no citation.</p>
<h2>Next steps</h2>
<p>Home EV charger installation also depends on your meter and DNO approval.</p>
</article></body></html>
`

describe('Phase 5 decision policy matrix (A–E, H, M)', () => {
  it('A: SUPPORTED + CURRENT → no issue (PASS)', () => {
    const d = decideClaimIssue({
      evidenceStatus: 'SUPPORTED',
      freshnessStatus: 'CURRENT',
      material: true,
      figureText: 'up to £350',
    })
    expect(d.severity).toBeNull()
    expect(d.blocking).toBe(false)
    expect(d.fixStatus).toBe('NO_FIX_NEEDED')
  })

  it('B: SUPPORTED + currency unknown → REVIEW/ADVISORY info, not FAIL', () => {
    const d = decideClaimIssue({
      evidenceStatus: 'SUPPORTED',
      freshnessStatus: defaultFreshnessForEvidence('SUPPORTED'),
      material: true,
      figureText: 'up to £350',
    })
    expect(d.severity).toBe('info')
    expect(d.blocking).toBe(false)
    expect(d.dimension).toBe('freshness')
    expect(d.title).toMatch(/Currentness verification recommended/i)
    expect(d.title).not.toMatch(/properly sourced, just double-check/i)
  })

  it('C: HISTORICAL + SUPPORTED → info / no fail', () => {
    const d = decideClaimIssue({
      evidenceStatus: 'SUPPORTED',
      freshnessStatus: 'HISTORICAL',
      material: true,
      figureText: '£350',
    })
    expect(d.severity).toBe('info')
    expect(d.blocking).toBe(false)
    expect(d.title).toMatch(/Historical claim verified/i)
  })

  it('D: OUTDATED current claim → critical + blocking', () => {
    const d = decideClaimIssue({
      evidenceStatus: 'OUTDATED',
      freshnessStatus: 'OUTDATED',
      material: true,
      figureText: 'up to £350',
    })
    expect(d.severity).toBe('critical')
    expect(d.blocking).toBe(true)
    expect(d.title).toMatch(/outdated/i)
  })

  it('E: CONTRADICTED material → critical + blocking', () => {
    const d = decideClaimIssue({
      evidenceStatus: 'CONTRADICTED',
      freshnessStatus: 'OUTDATED',
      material: true,
      figureText: 'up to £350',
    })
    expect(d.severity).toBe('critical')
    expect(d.blocking).toBe(true)
    expect(d.title).toMatch(/conflicts with authoritative source/i)
  })

  it('H: same evidence state cannot map to two conflicting severities', () => {
    const a = decideClaimIssue({
      evidenceStatus: 'PARTIALLY_SUPPORTED',
      freshnessStatus: 'NEEDS_REVIEW',
      material: true,
      figureText: '£350',
    })
    const b = decideClaimIssue({
      evidenceStatus: 'PARTIALLY_SUPPORTED',
      freshnessStatus: 'NEEDS_REVIEW',
      material: true,
      figureText: '£350',
    })
    expect(a.severity).toBe(b.severity)
    expect(a.title).toBe(b.title)
    expect(a.blocking).toBe(b.blocking)
    // legacy severityForClaimEvidence must not disagree on critical path
    expect(severityForClaimEvidence('CONTRADICTED')).toBe(
      decideClaimIssue({
        evidenceStatus: 'CONTRADICTED',
        freshnessStatus: 'OUTDATED',
        material: true,
      }).severity,
    )
  })

  it('claim issues carry the full decision field set', () => {
    const issues = evaluateGrantFigureClaims(`
      <p>Eligible renters can claim up to £350 with no citation.</p>
    `)
    expect(issues.length).toBeGreaterThan(0)
    for (const i of issues) {
      expect(i.id).toBeTruthy()
      expect(i.category).toBeTruthy()
      expect(i.evidenceStatus).toBeTruthy()
      expect(i.freshnessStatus).toBeTruthy()
      expect(['critical', 'warning', 'info']).toContain(i.severity)
      expect(typeof i.blocking).toBe('boolean')
      expect(i.dimension).toBeTruthy()
      expect(i.title).toBeTruthy()
      expect(i.explanation).toBeTruthy()
      expect(i.evidence).toBeTruthy()
      expect(i.fixStatus).toBeTruthy()
      expect(i.affectsDimensions?.length).toBeGreaterThan(0)
      // Title must not soft-pedal a critical/warning
      if (i.severity === 'critical' || i.severity === 'warning') {
        expect(i.title).not.toMatch(/properly sourced, just double-check/i)
      }
    }
  })

  it('M: PARTIAL title matches warning severity (no soft "properly sourced" copy)', () => {
    const d = decideClaimIssue({
      evidenceStatus: 'PARTIALLY_SUPPORTED',
      freshnessStatus: 'NEEDS_REVIEW',
      material: true,
      figureText: 'up to £350',
    })
    expect(d.severity).toBe('warning')
    expect(d.title).toMatch(/Currentness verification required/i)
    expect(d.title).not.toMatch(/properly sourced/i)
    expect(d.alsoAffects).toContain('freshness')
  })
})

describe('Phase 5 dimension + Fact Sourcing consistency (F, G)', () => {
  it('F: Factual FAIL and Freshness PASS cannot coexist for the same PARTIAL claim', () => {
    const issues = evaluateGrantFigureClaims(`
      <p>Eligible renters can claim up to £350 toward installation.
      See the <a href="${GOV_GRANT}">official grants collection</a> for scheme rules.</p>
    `)
    const partial = issues.find((i) => i.evidenceStatus === 'PARTIALLY_SUPPORTED')
    // If claim model says PARTIAL (official/topical, figure not in context)
    if (partial) {
      expect(partial.severity).toBe('warning')
      expect(partial.affectsDimensions).toEqual(
        expect.arrayContaining(['factual_verification', 'freshness']),
      )
      const board = buildExplainableScore(issues)
      const factual = board.dimensions.find((d) => d.id === 'factual_verification')!
      const freshness = board.dimensions.find((d) => d.id === 'freshness')!
      expect(factual.status).toBe('REVIEW')
      expect(freshness.status).toBe('REVIEW')
      // Explicit shared state — not FAIL vs PASS
      expect(factual.status).toBe(freshness.status)
    } else {
      // SUPPORTED path: freshness ADVISORY, factual PASS — also consistent
      const supported = issues.find((i) => i.evidenceStatus === 'SUPPORTED')
      expect(supported).toBeTruthy()
      const board = buildExplainableScore(issues)
      expect(board.dimensions.find((d) => d.id === 'factual_verification')!.status).toBe('PASS')
      expect(board.dimensions.find((d) => d.id === 'freshness')!.status).toBe('ADVISORY')
    }
  })

  it('G: Fact Sourcing consumes canonical claim-evidence (href alone ≠ sourced for PARTIAL/UNSUPPORTED)', () => {
    const html = `
      <p>Eligible renters can claim up to £350 toward installation.
      See <a href="${GOV_GRANT}">grants</a> for details.</p>
    `
    const evidence = evaluateClaimEvidence(html)
    const fig = evidence.find((e) => /£350/i.test(e.figureText || ''))!
    expect(fig).toBeTruthy()
    expect(['PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'SUPPORTED']).toContain(fig.status)

    const map = new Map([[(fig.figureText || '').toLowerCase(), fig]])
    const sentence =
      'Eligible renters can claim up to £350 toward installation. See grants for details.'
    const paragraphWithHref = `<a href="${GOV_GRANT}">grants</a> Eligible renters can claim up to £350 toward installation.`

    const sourced = isSentenceSourced(sentence, paragraphWithHref, {
      claimEvidenceByFigure: map,
    })
    if (fig.status === 'SUPPORTED') {
      expect(sourced).toBe(true)
    } else {
      // PARTIAL / UNSUPPORTED must not inflate Fact Sourcing via bare href
      expect(sourced).toBe(false)
    }
  })
})

describe('Phase 5 score + publish + Fix All copy (I, J, K, L)', () => {
  it('I: final score is calculated via one formula (scoreFromIssues ≡ buildExplainableScore)', () => {
    const issues = [
      { id: 'a', category: 'grant-figure', severity: 'critical' as const, title: 'Unsupported' },
      { id: 'b', category: 'hedging', severity: 'warning' as const, title: 'Hedge' },
      { id: 'c', category: 'word-count', severity: 'info' as const, title: 'Short' },
    ]
    expect(scoreFromIssues(issues)).toBe(buildExplainableScore(issues).score)
    expect(scoreFromIssues(issues)).toBe(75)
  })

  it('J: persisted/streamed/UI score path uses recomputeQualityGateTotals → explainable.score', () => {
    const gate = recomputeQualityGateTotals({
      issues: [
        {
          id: 'fact-1',
          severity: 'critical',
          category: 'grant-figure',
          title: 'Unsupported material figure — verify before publishing: "75%"',
          description: 'x',
          autoFixable: false,
          blocking: true,
        },
        {
          id: 'fact-2',
          severity: 'warning',
          category: 'grant-figure',
          title: 'Currentness verification required: "up to £350"',
          description: 'y',
          autoFixable: false,
          affectsDimensions: ['factual_verification', 'freshness'],
        },
        {
          id: 'hedge-1',
          severity: 'warning',
          category: 'hedging',
          title: 'Over-hedging',
          description: 'z',
          autoFixable: false,
        },
      ],
      autoFixedCount: 0,
      articleAfterAutoFix: '<p>x</p>',
    })
    expect(gate.score).toBe(70)
    expect(gate.explainable.score).toBe(70)
    expect(gate.score).toBe(scoreFromIssues(gate.issues))
  })

  it('K: 0 confirmed fixes does not produce unexplained decimal score copy', () => {
    const summary = formatFixAllScoreSummary({
      confirmedFixCount: 0,
      scoreBefore: 70,
      scoreAfter: 70,
      stillNeedsManualReview: 3,
    })
    expect(summary).toMatch(/Confirmed 0 fix\(es\)/)
    expect(summary).toMatch(/Score 70 → 70/)
    expect(summary).not.toMatch(/70\.3/)
    expect(summary).toMatch(/·/)
  })

  it('L: publish decision names the actual blocker title', () => {
    const result = buildExplainableScore([
      {
        id: 'fact-1',
        category: 'grant-figure',
        severity: 'critical',
        title: 'Unsupported material figure — verify before publishing: "75%"',
        blocking: true,
      },
    ])
    expect(result.publishDecision).toBe('BLOCKED')
    expect(result.publishDecisionReason).toMatch(/75%/)
    expect(result.publishDecisionReason).not.toMatch(/brand, topic alignment, structured-data/i)
  })
})

describe('Phase 5 real fixture — contradictory UI case', () => {
  it('traces PARTIAL + unsupported figure to consistent dimensions, titles, score', () => {
    const evidence = evaluateClaimEvidence(REAL_PARTIAL_FIXTURE)
    const threeFifty = evidence.find((e) => /£350/i.test(e.figureText || ''))
    const seventyFive = evidence.find((e) => /75%/i.test(e.figureText || ''))
    expect(threeFifty).toBeTruthy()
    expect(seventyFive).toBeTruthy()

    const issues = evaluateGrantFigureClaims(REAL_PARTIAL_FIXTURE)
    const board = buildExplainableScore(issues)

    // No soft "properly sourced, just double-check" on any issue
    for (const i of issues) {
      expect(i.title).not.toMatch(/properly sourced, just double-check/i)
      expect(i.evidenceStatus).toBeTruthy()
      expect(i.freshnessStatus).toBeTruthy()
      expect(i.affectsDimensions?.length).toBeGreaterThan(0)
    }

    const critical = issues.filter((i) => i.severity === 'critical')
    const warnings = issues.filter((i) => i.severity === 'warning')

    // Material UNSUPPORTED 75% must block
    expect(critical.some((i) => /75%/.test(i.figureText || '') || /75%/.test(i.title))).toBe(
      true,
    )

    const factual = board.dimensions.find((d) => d.id === 'factual_verification')!
    const freshness = board.dimensions.find((d) => d.id === 'freshness')!

    // If PARTIAL warning exists, Freshness must not silently PASS
    const partialIssue = issues.find((i) => i.evidenceStatus === 'PARTIALLY_SUPPORTED')
    if (partialIssue) {
      expect(partialIssue.title).toMatch(/Currentness verification required/i)
      expect(freshness.status).not.toBe('PASS')
      expect(factual.status).toBe('FAIL') // critical also present
    }

    // Fact Sourcing must not treat PARTIAL/UNSUPPORTED as fully sourced via href
    if (threeFifty && threeFifty.status !== 'SUPPORTED') {
      const map = new Map([
        [(threeFifty.figureText || '').toLowerCase(), threeFifty],
      ])
      expect(
        isSentenceSourced(
          'Eligible renters can claim up to £350 toward charger installation costs under the current scheme.',
          `<a href="${GOV_GRANT}">official</a>`,
          { claimEvidenceByFigure: map },
        ),
      ).toBe(false)
    }

    expect(board.publishDecision).toBe('BLOCKED')
    expect(board.publishDecisionReason).toMatch(/Blocked by/)
    expect(board.score).toBe(scoreFromIssues(issues))
    expect(Number.isInteger(board.score)).toBe(true)

    // sanity: critical + warnings reduce score predictably
    expect(board.score).toBe(Math.max(0, 100 - critical.length * 20 - warnings.length * 5))
  })

  it('SUPPORTED figure in citation context is not a factual failure', () => {
    const html = `
      <p>Eligible businesses can claim up to £500 towards chargepoint hardware via the
      <a href="${GOV_GRANT}">GOV.UK low-emission vehicle grants</a> collection.</p>
    `
    const fig = evaluateClaimEvidence(html).find((e) => /£500/i.test(e.figureText || ''))!
    expect(fig.status).toBe('SUPPORTED')
    const issues = evaluateGrantFigureClaims(html)
    expect(issues.every((i) => i.severity !== 'critical')).toBe(true)
    expect(issues.every((i) => i.severity === 'info' || i.severity === 'warning')).toBe(true)
    const board = buildExplainableScore(issues)
    expect(board.dimensions.find((d) => d.id === 'factual_verification')!.status).toBe('PASS')
  })

  it('live CONTRADICTED evidence still blocks after decision policy', () => {
    let ev = evaluateClaimEvidence(
      `<p>The grant is currently up to £350 for renters.</p>`,
    ).find((e) => /£350/i.test(e.figureText || ''))!
    ev = applyLiveSourceEvidence(ev, {
      sourceUrl: GOV_GRANT,
      sourceDate: '1 April 2026',
      supportingPassage: 'Current maximum: £500',
      contradicted: true,
      outdated: true,
    })
    const d = decideClaimIssue({
      evidenceStatus: ev.status,
      freshnessStatus: 'OUTDATED',
      material: true,
      figureText: ev.figureText,
    })
    expect(d.severity).toBe('critical')
    expect(d.blocking).toBe(true)
  })
})

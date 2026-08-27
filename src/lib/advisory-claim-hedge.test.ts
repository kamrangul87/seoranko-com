/**
 * Advisory-claim exemption + hedge-repetition mechanical fixes.
 *
 * 1) claim-evidence / dated-policy must not flag advisory opinions like
 *    "the smarter financial choice is right-sizing your EV charger now…"
 * 2) hedge-repetition stripper keeps ≤3 filler hedges and clears the
 *    repetitive-boilerplate Quality Gate warning.
 *
 * Also re-checks earlier recurring-fix invariants (dated-policy strip,
 * scannability, typography) stay intact.
 */

import { describe, it, expect } from 'vitest'
import {
  isAdvisoryOpinionSentence,
  requiresCitation,
  hasVerifiableFactMarker,
} from './claim-factuality'
import {
  extractImportantFactualClaims,
  evaluateClaimEvidence,
} from './claim-evidence'
import {
  collectFactualClaimIssues,
  buildDatedPolicyIssues,
  runQualityGate,
} from './article-quality-gate'
import { detectDatedClaims, detectTimeAnchoredClaims } from './dated-claim-detector'
import { enforceHedgeRepetition } from './hedge-repetition-enforcer'
import { stripHedgeRepetition, HEDGE_FILLER_KEEP_LIMIT } from './hedge-repetition-stripper'
import { evaluateHedging } from './hedging-policy'
import { enforceDatedPolicy } from './dated-policy-enforcer'
import { enforceScannability } from './scannability-enforcer'
import { normalizeArticleTypography } from './typography-normalizer'
import { assessTimeSensitivity } from './time-sensitivity-policy'

function padArticle(body: string, minWords = 850): string {
  const filler =
    'Home charging works best when the circuit is dedicated and the cable run is planned carefully. '
  const words = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
  if (words >= minWords) return body
  const need = minWords - words + 20
  const extras = Array.from({ length: Math.ceil(need / 15) }, (_, i) =>
    `<p>Practical note ${i + 1}: ${filler}Keep documentation handy for the installer visit.</p>`,
  ).join('\n')
  return `<article>${body}\n${extras}</article>`
}

describe('claim-factuality — advisory vs verifiable', () => {
  it('exempts smarter-choice advice with no figure', () => {
    const s =
      'The smarter financial choice is right-sizing your EV charger now rather than waiting for the next grant scheme.'
    expect(isAdvisoryOpinionSentence(s)).toBe(true)
    expect(requiresCitation(s)).toBe(false)
    expect(hasVerifiableFactMarker(s)).toBe(false)
  })

  it('still requires citation for grant figures and named rules', () => {
    expect(requiresCitation('The grant covers up to 40% of installation costs.')).toBe(true)
    expect(requiresCitation('Applicants must meet the scheme eligibility rules.')).toBe(true)
    expect(requiresCitation('As of August 2026, the grant pays up to £350.')).toBe(true)
  })

  it('advisory + figure still requires citation', () => {
    expect(
      requiresCitation('Consider the grant — it covers up to 40% of costs.'),
    ).toBe(true)
  })
})

describe('claim-evidence / dated-policy skip advisory opinions', () => {
  it('does not extract claim-evidence for smarter-choice advice', () => {
    const html = `<article>
      <p>The smarter financial choice is right-sizing your EV charger now rather than waiting for the next grant scheme.</p>
      <p>It is worth checking official guidance before you book an installer.</p>
    </article>`
    expect(extractImportantFactualClaims(html)).toEqual([])
    expect(evaluateClaimEvidence(html)).toEqual([])
    expect(collectFactualClaimIssues(html)).toEqual([])
  })

  it('still extracts real numeric claims', () => {
    const html = `<article>
      <p>The grant covers up to 40% of installation costs.</p>
      <p>Consider right-sizing your charger rather than waiting.</p>
    </article>`
    const claims = extractImportantFactualClaims(html)
    expect(claims.some((c) => /40%/.test(c.figureText || ''))).toBe(true)
    expect(claims.every((c) => !/smarter|right-sizing/i.test(c.claimText))).toBe(true)
  })

  it('dated-policy ignores advisory "now" + grant noun', () => {
    const now = new Date('2026-08-27T00:00:00Z')
    const html =
      '<p>The smarter financial choice is right-sizing your EV charger now rather than waiting for the next grant scheme.</p>'
    expect(detectDatedClaims(html, now)).toEqual([])
    expect(detectTimeAnchoredClaims(html, now)).toEqual([])
    expect(buildDatedPolicyIssues(html, { now }).filter((i) => i.category === 'dated-policy')).toEqual(
      [],
    )
    expect(assessTimeSensitivity(html.replace(/<\/?p>/g, ''), now).requiresVerification).toBe(false)
  })

  it('dated-policy still flags unsourced dated grant figures', () => {
    const now = new Date('2026-08-27T00:00:00Z')
    const html = '<p>As of August 2026, the grant covers up to 75% of installation costs.</p>'
    expect(detectDatedClaims(html, now).length).toBeGreaterThan(0)
  })
})

describe('hedge-repetition stripper', () => {
  it(`keeps at most ${HEDGE_FILLER_KEEP_LIMIT} typically and removes the rest`, () => {
    const html = Array.from(
      { length: 8 },
      (_, i) => `<p>Installers typically finish job ${i + 1} in a day.</p>`,
    ).join('\n')
    const result = stripHedgeRepetition(html)
    const count = (result.html.match(/\btypically\b/gi) || []).length
    expect(count).toBe(HEDGE_FILLER_KEEP_LIMIT)
    expect(result.removedByToken.typically).toBe(5)
  })

  it('clears REAL_REPETITION actionable findings after enforce', () => {
    const html = Array.from(
      { length: 8 },
      () => '<p>It is typically important to check your meter before you book.</p>',
    ).join('\n')
    expect(evaluateHedging(html).actionable.some((a) => a.classification === 'REAL_REPETITION')).toBe(
      true,
    )
    const enforced = enforceHedgeRepetition(html)
    expect(enforced.stillRepetitive).toBe(false)
    expect((enforced.html.match(/\btypically\b/gi) || []).length).toBeLessThanOrEqual(3)
  })
})

const FIXTURES = [
  {
    name: 'ev-charger-sizing',
    keyword: 'ev charger sizing',
    raw: padArticle(`
<h1>EV Charger Sizing</h1>
<p>Written by Kamran Gul</p>
<p>The smarter financial choice is right-sizing your EV charger now rather than waiting for the next grant scheme.</p>
<p>It is worth considering a dedicated circuit before you book.</p>
<p>Installers typically finish a standard job in a day. Units typically need a spare way. Quotes typically include labour. Boards typically need upgrading. Cables typically run under driveways. Visits typically take two hours. Engineers typically prefer mornings. Bookings typically slip a week.</p>
<p>Confirm rates on the <a href="https://www.gov.uk/government/publications/electric-vehicle-chargepoint-grant">EV chargepoint grant page</a>.</p>
`),
  },
  {
    name: 'heat-pump-advice',
    keyword: 'heat pump advice',
    raw: padArticle(`
<h1>Heat Pump Advice</h1>
<p>Written by Kamran Gul</p>
<p>Consider a heat-loss survey before you replace the boiler — the smarter choice is sizing the system to the home you have.</p>
<p>Homes generally need a survey. Quotes generally exclude radiators. Installs generally take a week. Grants generally need an EPC. Engineers generally check flow temperatures. Owners generally underestimate pipework. Surveys generally find cold spots. Bookings generally move once.</p>
<p>Official rules are on the <a href="https://www.gov.uk/apply-boiler-upgrade-scheme">Boiler Upgrade Scheme guidance</a>.</p>
`),
  },
  {
    name: 'workplace-charging-tips',
    keyword: 'workplace charging tips',
    raw: padArticle(`
<h1>Workplace Charging Tips</h1>
<p>Written by Kamran Gul</p>
<p>It is worth looking at load management first — preferably before you order sockets.</p>
<p>Sites often start with two bays. Fleets often charge overnight. Managers often overestimate demand. Staff often prefer workplace charging. Quotes often omit civils. Cabinets often need three-phase. Approvals often take longer. Budgets often miss software.</p>
<p>Operators should confirm details via
<a href="https://www.gov.uk/guidance/workplace-charging-scheme">Workplace Charging Scheme guidance</a>.</p>
`),
  },
] as const

describe('definition of done — 3 fixtures clear advisory FP + hedge repetition', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: no advisory claim-evidence / dated-policy; hedge strip clears repetition`, async () => {
      const beforeHedge = evaluateHedging(fixture.raw)
      expect(
        beforeHedge.actionable.some((a) => a.classification === 'REAL_REPETITION') ||
          Object.values(beforeHedge.byToken).some((n) => n > 3),
      ).toBe(true)

      const hedge = enforceHedgeRepetition(fixture.raw)
      expect(hedge.stillRepetitive).toBe(false)

      const claimIssues = collectFactualClaimIssues(hedge.html).filter(
        (i) => i.category === 'claim-evidence' || i.category === 'grant-figure',
      )
      expect(claimIssues).toEqual([])

      const dated = buildDatedPolicyIssues(hedge.html, {
        now: new Date('2026-08-27T00:00:00Z'),
      }).filter((i) => i.category === 'dated-policy')
      expect(dated).toEqual([])

      const qr = await runQualityGate(hedge.html, {
        brand: 'autodun',
        keyword: fixture.keyword,
        authorName: 'Kamran Gul',
        registeredLinkDomains: ['autodun.com', 'gov.uk'],
        minWordCount: 400,
        factSourcingScore: 90,
        eeatScore: 80,
        humanScore: 80,
        keywordDensityScore: 80,
        skipLiveVerification: true,
      })

      expect(
        qr.issues.filter((i) => i.category === 'claim-evidence' || i.category === 'grant-figure'),
      ).toEqual([])
      expect(qr.issues.filter((i) => i.id === 'hedging-real-repetition')).toEqual([])
      expect(qr.issues.filter((i) => i.category === 'dated-policy')).toEqual([])
    })
  }
})

describe('earlier recurring fixes stay intact', () => {
  it('date-anchor strip still clears time-anchored dated-policy pressure', () => {
    const now = new Date('2026-08-26T00:00:00Z')
    const result = enforceDatedPolicy(
      '<p>As of August 2026, the grant covers up to 75% of installation costs.</p>',
      now,
    )
    expect(result.strippedCount).toBeGreaterThan(0)
    expect(result.remainingTimeAnchored).toEqual([])
  })

  it('scannability enforcer still splits dense paragraphs', () => {
    const sentences = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => `${prefix} sentence number ${i + 1} about home charging.`).join(
        ' ',
      )
    const html = Array.from({ length: 5 }, (_, i) => `<p>${sentences(7, `P${i}`)}</p>`).join('\n')
    const result = enforceScannability(html)
    expect(result.remainingDenseParagraphs).toEqual([])
    expect(result.error).toBeUndefined()
  })

  it('typography normalizer still curls apostrophes', () => {
    const out = normalizeArticleTypography(`<p>It's the driver's charger.</p>`)
    expect(out).toContain('\u2019')
  })
})

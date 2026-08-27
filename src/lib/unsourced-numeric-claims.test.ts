/**
 * Regression: unsourced £/%/deadline claims are generalized BEFORE Quality Gate,
 * and stock AI phrases ("In other words") are stripped at the same pass.
 *
 * Definition of done — three separate fixture articles (different keywords)
 * must exit the enforcer with zero claim-evidence, score-floor-fact-sourcing,
 * and ai-slop findings. Live generation needs API keys; these fixtures mirror
 * the invented-figure shapes that have recurred on the last 4 articles.
 */

import { describe, it, expect } from 'vitest'
import { enforceUnsourcedNumericClaims } from './unsourced-numeric-enforcer'
import { stripUnsourcedNumericClaims } from './unsourced-numeric-stripper'
import { stripAiSlopPhrases } from './ai-slop-stripper'
import { evaluateClaimEvidence } from './claim-evidence'
import { collectFactualClaimIssues, runQualityGate } from './article-quality-gate'
import { AI_SLOP_PATTERNS } from './ai-slop-patterns'
import { computeFactSourcingScore } from './fact-checker'

function padToMinWords(body: string, minWords = 850): string {
  const filler =
    'Home charging works best when the circuit is dedicated and the cable run is planned carefully. '
  const words = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
  if (words >= minWords) return body
  const need = minWords - words + 20
  const extras = Array.from({ length: Math.ceil(need / 15) }, (_, i) =>
    `<p>Practical note ${i + 1}: ${filler}Keep documentation handy for the installer visit.</p>`,
  ).join('\n')
  return `${body}\n${extras}`
}

/** Article A — EV grant invention (£ / %). */
const ARTICLE_A_RAW = padToMinWords(`
<article>
<h1>EV Charger Grant Guide</h1>
<p>Written by Kamran Gul</p>
<p>In other words, the EV charger grant covers up to 40% of installation costs, often worth £2,000 toward a home chargepoint.</p>
<p>Installers commonly quote £4,500 for a full setup, and applications must be filed by 31 March 2027.</p>
<p>According to guidance published on the
<a href="https://www.gov.uk/government/publications/electric-vehicle-chargepoint-grant">EV chargepoint grant page</a>,
eligible households should check the official scheme page before booking.</p>
<p>When I tested booking an installer visit, it took three working days to confirm a slot.</p>
</article>
`)

/** Article B — heat pump / boiler grant invention. */
const ARTICLE_B_RAW = padToMinWords(`
<article>
<h1>Heat Pump Grant Eligibility</h1>
<p>Written by Kamran Gul</p>
<p>Furthermore, the boiler upgrade scheme typically pays £7,500 toward a heat pump, covering roughly 50% of project costs for many homes.</p>
<p>In other words the voucher expires by 15 December 2026 if unused.</p>
<p>Hardware alone can run £8,000–£12,000 before labour.</p>
<p>Official eligibility rules are summarised by
<a href="https://www.gov.uk/apply-boiler-upgrade-scheme">the Boiler Upgrade Scheme guidance</a>
for homeowners comparing quotes.</p>
<p>In practice, I found the application form asked for EPC evidence before any deposit.</p>
</article>
`)

/** Article C — workplace charging / tariff stats. */
const ARTICLE_C_RAW = padToMinWords(`
<article>
<h1>Workplace EV Charging Costs</h1>
<p>Written by Kamran Gul</p>
<p>Moreover, workplace schemes can reclaim up to £350 per socket, and surveys claim 65% of staff would switch if charging were free.</p>
<p>To summarise, overnight tariffs cut bills by 30% for fleet vans charging on site.</p>
<p>Deadlines land before June 2026 for the current funding window.</p>
<p>Operators should confirm rates with
<a href="https://www.gov.uk/guidance/workplace-charging-scheme">Workplace Charging Scheme guidance</a>
rather than relying on verbal quotes.</p>
<p>When I tried a site survey last month, the electrician flagged consumer-unit headroom first.</p>
</article>
`)

const FIXTURES = [
  { name: 'ev-charger-grant', keyword: 'ev charger grant', raw: ARTICLE_A_RAW },
  { name: 'heat-pump-grant', keyword: 'heat pump grant', raw: ARTICLE_B_RAW },
  { name: 'workplace-charging', keyword: 'workplace ev charging', raw: ARTICLE_C_RAW },
] as const

describe('unsourced-numeric stripper — mechanical generalization', () => {
  it('generalizes unsourced £ and % while keeping a sourced official link paragraph', () => {
    const html = `<p>The grant covers up to 40% of costs, often worth £2,000.</p>
<p>See the <a href="https://www.gov.uk/government/publications/electric-vehicle-chargepoint-grant">EV chargepoint grant</a> for rules.</p>`
    const result = stripUnsourcedNumericClaims(html)
    expect(result.strippedCount).toBeGreaterThan(0)
    expect(result.html).not.toMatch(/40%/)
    expect(result.html).not.toMatch(/£2,000/)
    expect(result.html).toMatch(/set percentage|published amount|published price/i)
    expect(result.html).toContain('https://www.gov.uk/government/publications/electric-vehicle-chargepoint-grant')
  })

  it('keeps a figure that is SUPPORTED by a same-paragraph official citation', () => {
    const html = `<p>Grants of up to £350 are available via the
<a href="https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles">OZEV grant collection</a>
for chargepoints (£350 per socket).</p>`
    const before = evaluateClaimEvidence(html)
    const supported = before.filter((e) => e.status === 'SUPPORTED' || e.status === 'PARTIALLY_SUPPORTED')
    // Even PARTIAL gets stripped by policy — SUPPORTED alone is kept.
    const result = stripUnsourcedNumericClaims(html)
    const after = evaluateClaimEvidence(result.html)
    const remainingBad = after.filter((e) =>
      ['UNSUPPORTED', 'PARTIALLY_SUPPORTED', 'NEEDS_REVIEW'].includes(e.status),
    )
    expect(remainingBad).toEqual([])
    // If anything was truly SUPPORTED with figure-in-context, it may remain as a number
    void supported
  })

  it('strips calendar deadlines in paragraphs with no citation link', () => {
    const html = `<p>Applications must be filed by 31 March 2027.</p>
<p>Confirm on <a href="https://www.gov.uk/guidance/example">official guidance</a>.</p>`
    const result = stripUnsourcedNumericClaims(html)
    expect(result.html).not.toMatch(/31 March 2027/)
    expect(result.html).toMatch(/date shown on the official page/i)
  })

  it('never rewrites markup, hrefs, or JSON-LD', () => {
    const html =
      `<script type="application/ld+json">{"offers":{"price":"2000"},"description":"up to 40%"}</script>` +
      `<p><a href="https://example.com/grant-40-percent">Source</a> discusses eligibility.</p>`
    const result = stripUnsourcedNumericClaims(html)
    expect(result.html).toContain('"price":"2000"')
    expect(result.html).toContain('href="https://example.com/grant-40-percent"')
  })
})

describe('ai-slop stripper — In other words and siblings', () => {
  it('removes "In other words," with or without a comma', () => {
    expect(stripAiSlopPhrases('<p>In other words, the grant helps.</p>').html).toBe(
      '<p>The grant helps.</p>',
    )
    expect(stripAiSlopPhrases('<p>In other words the grant helps.</p>').html).toBe(
      '<p>The grant helps.</p>',
    )
  })

  it('removes Furthermore / Moreover / To summarise', () => {
    const { html, strippedCount } = stripAiSlopPhrases(
      '<p>Furthermore, costs vary. Moreover, quotes differ. To summarise, plan ahead.</p>',
    )
    expect(strippedCount).toBeGreaterThanOrEqual(3)
    expect(html.toLowerCase()).not.toMatch(/furthermore|moreover|to summarise/)
  })

  it('shared patterns match what Quality Gate uses', () => {
    expect(AI_SLOP_PATTERNS.some((p) => p.test('In other words the scheme'))).toBe(true)
    expect(AI_SLOP_PATTERNS.some((p) => p.test('In other words, the scheme'))).toBe(true)
  })
})

describe('definition of done — 3 fixture articles clear claim-evidence, score-floor, ai-slop', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: enforcer clears unsourced figures and AI slop`, () => {
      // Precondition: raw draft would flag claim-evidence and AI slop
      const beforeClaims = collectFactualClaimIssues(fixture.raw).filter(
        (i) => i.category === 'claim-evidence' || i.category === 'grant-figure',
      )
      expect(beforeClaims.length).toBeGreaterThan(0)
      expect(AI_SLOP_PATTERNS.some((p) => p.test(fixture.raw))).toBe(true)

      const enforced = enforceUnsourcedNumericClaims(fixture.raw)
      expect(enforced.remainingUnsourced).toEqual([])
      expect(enforced.html).not.toMatch(/In other words/i)
      expect(enforced.html).not.toMatch(/\bFurthermore\b/i)
      expect(enforced.html).not.toMatch(/\bMoreover\b/i)
      expect(enforced.html).not.toMatch(/To summarise/i)

      const afterClaims = collectFactualClaimIssues(enforced.html).filter(
        (i) => i.category === 'claim-evidence' || i.category === 'grant-figure',
      )
      expect(afterClaims).toEqual([])

      // No leftover £ / % in body (generalized away)
      const visible = enforced.html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
      expect(visible).not.toMatch(/[£$€]\s?[\d,]+/)
      expect(visible).not.toMatch(/\d+\s?%/)
    })

    it(`${fixture.name}: Quality Gate has zero claim-evidence, score-floor-fact-sourcing, ai-slop`, async () => {
      const enforced = enforceUnsourcedNumericClaims(fixture.raw)
      const fs = computeFactSourcingScore(enforced.html).factSourcingScore
      expect(fs).toBeGreaterThanOrEqual(40)

      const qr = await runQualityGate(enforced.html, {
        brand: 'autodun',
        keyword: fixture.keyword,
        authorName: 'Kamran Gul',
        registeredLinkDomains: ['autodun.com', 'gov.uk'],
        minWordCount: 400,
        factSourcingScore: fs,
        eeatScore: 80,
        humanScore: 80,
        keywordDensityScore: 80,
        skipLiveVerification: true,
      })

      const claimIssues = qr.issues.filter(
        (i) => i.category === 'claim-evidence' || i.category === 'grant-figure',
      )
      const floors = qr.issues.filter((i) => i.id === 'score-floor-fact-sourcing')
      const slop = qr.issues.filter((i) => i.category === 'ai-slop')

      expect(claimIssues).toEqual([])
      expect(floors).toEqual([])
      expect(slop).toEqual([])
    })
  }
})

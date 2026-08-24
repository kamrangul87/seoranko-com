/**
 * Section I — claim-scope / dedupe / material-gating regressions.
 * Hard requirement: every case I1–I7 must pass.
 */
import { describe, it, expect } from 'vitest'
import {
  evaluateClaimEvidence,
  extractImportantFactualClaims,
  claimIdentityKey,
  normalizeClaimFigureIdentity,
  isGrantFigureOwnedClaim,
} from './claim-evidence'
import {
  evaluateGrantFigureClaims,
  evaluateClaimEvidenceIssues,
  collectFactualClaimIssues,
  runQualityGate,
} from './article-quality-gate'
import { buildExplainableScore } from './quality-score-dimensions'
import { scoreFromIssues } from './autofix-confirmation'

const GOV_GRANT =
  'https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles'

/** Forensic live article that scored 5/100 before this fix. */
export const LIVE_FALSE_POSITIVE_FIXTURE = `<!DOCTYPE html><html><head>
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
<meta name="description" content="EV charger costs">
<title>EV charger guide</title>
<script type="application/ld+json">{"@type":"Article","offers":{"price":"400"}}</script>
</head><body><article>
<h1>EV charger</h1>
<p>Typical hardware costs £800 to £1,200 depending on the unit.</p>
<p>Labour often adds another £400. Some quotes say around £1,200 installed.</p>
<p>The <a href="${GOV_GRANT}">OZEV grant</a> may cover up to £350 for eligible renters.</p>
<p>Industry surveys say 40% of homeowners wait for a DNO quote and 20% abandon the install.</p>
<p>Separately, another survey found 40% prefer overnight charging.</p>
</article></body></html>`

describe('Section I — claim scope, dedupe, material gating', () => {
  it('I1: robots/meta HTML is not used as claim location', () => {
    const html = `<!DOCTYPE html><html><head>
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
</head><body><article>
<p>Typical hardware costs £800 depending on the unit.</p>
</article></body></html>`
    const issues = collectFactualClaimIssues(html)
    expect(issues.length).toBeGreaterThan(0)
    for (const i of issues) {
      expect(i.location || '').not.toMatch(/robots|max-snippet|max-image-preview/i)
      expect(i.location || '').toMatch(/£800|hardware/i)
    }
    const extracted = extractImportantFactualClaims(html)
    expect(extracted.every((c) => c.figureText !== '400')).toBe(true)
  })

  it('I2: 40% restated twice + one GOV.UK grant link → exactly one 40% issue', () => {
    const html = `
      <article>
      <p>The <a href="${GOV_GRANT}">OZEV grant</a> may cover up to £350.</p>
      <p>Industry surveys say 40% of homeowners wait for a DNO quote.</p>
      <p>Separately, another survey found 40% prefer overnight charging.</p>
      </article>
    `
    const all = collectFactualClaimIssues(html)
    const forty = all.filter((i) => /40%/.test(i.figureText || '') || /40%/.test(i.title))
    expect(forty).toHaveLength(1)
  })

  it('I3: £1,200 and £1200 share one claim identity', () => {
    expect(
      claimIdentityKey({
        figureText: '£1,200',
        claimKind: 'price',
        claimText: 'Hardware costs £1,200.',
      }),
    ).toBe(
      claimIdentityKey({
        figureText: '£1200',
        claimKind: 'price',
        claimText: 'Some quotes say £1200.',
      }),
    )
    expect(normalizeClaimFigureIdentity('up to £1,200')).toBe(
      normalizeClaimFigureIdentity('£1200'),
    )
    const html = `<article>
      <p>Hardware costs £1,200 depending on the unit.</p>
      <p>Some installers quote £1200 without a comma.</p>
    </article>`
    const evidence = evaluateClaimEvidence(html)
    const twelve = evidence.filter(
      (e) => normalizeClaimFigureIdentity(e.figureText || '') === '£1200',
    )
    expect(twelve).toHaveLength(1)
    expect(twelve[0].occurrenceCount).toBe(2)
    const issues = collectFactualClaimIssues(html)
    expect(
      issues.filter((i) => normalizeClaimFigureIdentity(i.figureText || '') === '£1200'),
    ).toHaveLength(1)
  })

  it('I4: survey 40%/20% are not material-critical just because a grants URL exists', () => {
    const html = `<article>
      <p>See the <a href="${GOV_GRANT}">official grants collection</a> for scheme rules.</p>
      <p>Industry surveys say 40% of homeowners wait and 20% abandon the install.</p>
    </article>`
    const evidence = evaluateClaimEvidence(html)
    const pct = evidence.filter((e) => /%$/.test(e.figureText || ''))
    expect(pct.length).toBeGreaterThan(0)
    expect(pct.every((e) => !isGrantFigureOwnedClaim(e))).toBe(true)
    const issues = collectFactualClaimIssues(html)
    const pctIssues = issues.filter((i) => /%/.test(i.figureText || '') || /%/.test(i.title))
    expect(pctIssues.every((i) => i.severity !== 'critical')).toBe(true)
    expect(pctIssues.every((i) => i.category === 'claim-evidence')).toBe(true)
    expect(pctIssues.every((i) => !/Currentness verification required/i.test(i.title))).toBe(true)
  })

  it('I5: cited up to £350 with figure in citation context is not a factual FAIL', () => {
    const html = `
      <p>Eligible businesses can claim up to £500 towards chargepoint hardware via the
      <a href="${GOV_GRANT}">GOV.UK low-emission vehicle grants</a> collection.</p>
    `
    const fig = evaluateClaimEvidence(html).find((e) => /£500/i.test(e.figureText || ''))!
    expect(fig.status).toBe('SUPPORTED')
    const issues = collectFactualClaimIssues(html)
    const board = buildExplainableScore(issues)
    expect(board.dimensions.find((d) => d.id === 'factual_verification')!.status).not.toBe('FAIL')
    expect(issues.every((i) => i.severity !== 'critical')).toBe(true)
  })

  it('I6: grant-figure and claim-evidence skip filters are exact complements', () => {
    const html = LIVE_FALSE_POSITIVE_FIXTURE
    const grant = evaluateGrantFigureClaims(html)
    const other = evaluateClaimEvidenceIssues(html)
    const grantFigs = new Set(grant.map((i) => normalizeClaimFigureIdentity(i.figureText || '')))
    const otherFigs = new Set(
      other.filter((i) => i.figureText).map((i) => normalizeClaimFigureIdentity(i.figureText || '')),
    )
    for (const f of Array.from(grantFigs)) {
      expect(otherFigs.has(f)).toBe(false)
    }
    const combined = [...grant, ...other]
    const ids = combined.map((i) => i.figureText && normalizeClaimFigureIdentity(i.figureText))
    const unique = new Set(ids.filter(Boolean))
    expect(unique.size).toBe(ids.filter(Boolean).length)
  })

  it('I7: score is −20/−5 of unique issues only (no double-count)', () => {
    const issues = collectFactualClaimIssues(LIVE_FALSE_POSITIVE_FIXTURE)
    const board = buildExplainableScore(issues)
    expect(board.score).toBe(scoreFromIssues(issues))
    const critical = issues.filter((i) => i.severity === 'critical').length
    const warning = issues.filter((i) => i.severity === 'warning').length
    expect(board.score).toBe(Math.max(0, 100 - critical * 20 - warning * 5))
    const figKeys = issues
      .filter((i) => i.figureText)
      .map((i) => normalizeClaimFigureIdentity(i.figureText || ''))
    expect(figKeys.length).toBe(new Set(figKeys).size)
  })
})

describe('Live forensic fixture (was 5/100 with robots location + duplicate %)', () => {
  it('re-scores the investigation article without meta contamination or dual % issues', () => {
    const issues = collectFactualClaimIssues(LIVE_FALSE_POSITIVE_FIXTURE)
    const board = buildExplainableScore(issues)

    for (const i of issues) {
      expect(i.location || '').not.toMatch(/robots|max-snippet|max-image-preview/i)
    }

    const forty = issues.filter((i) => /40%/.test(i.figureText || '') || /40%/.test(i.title))
    expect(forty).toHaveLength(1)

    const grant350 = issues.filter(
      (i) => /£350/.test(i.figureText || '') || /£350/.test(i.title),
    )
    expect(grant350.every((i) => i.severity !== 'critical')).toBe(true)

    const prices = issues.filter((i) =>
      /£800|£1,200|£1200|£400/.test(`${i.figureText || ''} ${i.title}`),
    )
    expect(prices.every((i) => i.severity !== 'critical')).toBe(true)
    expect(prices.every((i) => i.category === 'claim-evidence')).toBe(true)

    expect(board.score).toBeGreaterThan(5)
    expect(board.score).toBe(scoreFromIssues(issues))
    expect(Number.isInteger(board.score)).toBe(true)
    // Unique warnings: £800, £1,200, £400, 40%, 20% → 100 − 5×5 = 75
    expect(board.score).toBe(75)
    expect(issues.filter((i) => i.severity === 'critical')).toHaveLength(0)
    expect(issues.filter((i) => i.severity === 'warning')).toHaveLength(5)
    expect(
      issues
        .filter((i) => i.severity === 'warning')
        .map((i) => i.figureText)
        .sort(),
    ).toEqual(['20%', '40%', '£1,200', '£400', '£800'])

    const factual = board.dimensions.find((d) => d.id === 'factual_verification')!
    expect(factual.status).toBe('REVIEW')
    expect(board.publishDecision).toBe('NEEDS_REVIEW')

    const extracted = extractImportantFactualClaims(LIVE_FALSE_POSITIVE_FIXTURE)
    expect(extracted.some((c) => c.figureText === '400' && !c.claimText.includes('£400'))).toBe(
      false,
    )
  })

  it('full Quality Gate on the same fixture: no robots location, one 40%, factual REVIEW', async () => {
    const qr = await runQualityGate(LIVE_FALSE_POSITIVE_FIXTURE, {
      keyword: 'EV charger',
      brand: 'TestBrand',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['gov.uk'],
      expectOrganizationLogo: false,
      minWordCount: 1,
      maxWordCount: 50_000,
      datedPolicy: { now: new Date('2026-08-20') },
    })

    for (const i of qr.issues) {
      expect(i.location || '').not.toMatch(/robots|max-snippet|max-image-preview/i)
    }

    const forty = qr.issues.filter((i) => /40%/.test(i.figureText || '') || /40%/.test(i.title))
    expect(forty).toHaveLength(1)

    const factIssues = qr.issues.filter(
      (i) => i.category === 'grant-figure' || i.category === 'claim-evidence',
    )
    expect(factIssues.filter((i) => i.severity === 'critical')).toHaveLength(0)
    const priceSurvey = factIssues.filter((i) =>
      /£800|£1,200|£1200|£400|40%|20%/.test(`${i.figureText || ''} ${i.title}`),
    )
    expect(priceSurvey).toHaveLength(5)
    expect(priceSurvey.every((i) => i.severity === 'warning')).toBe(true)
    expect(priceSurvey.every((i) => i.category === 'claim-evidence')).toBe(true)

    const grant350 = factIssues.filter(
      (i) => /£350/.test(i.figureText || '') || /£350/.test(i.title),
    )
    expect(grant350.every((i) => i.severity !== 'critical')).toBe(true)

    const factBoard = buildExplainableScore(
      factIssues.filter((i) => i.category === 'claim-evidence'),
    )
    // Same unique warnings as the forensic claim pass (£800/£1,200/£400/40%/20%).
    // £350 may become a grant-figure warning only after live GOV.UK auto-verify
    // (figure-missing) — that is outside claim-scope and must not restore 5/100.
    expect(factBoard.score).toBe(75)
    expect(factBoard.dimensions.find((d) => d.id === 'factual_verification')!.status).toBe('REVIEW')
    expect(factBoard.publishDecision).toBe('NEEDS_REVIEW')
    // Truncated fixture still has unrelated schema/author criticals; the 5→75
    // comparison is the claim-scope board, not this incomplete document's total.
  }, 30_000)
})

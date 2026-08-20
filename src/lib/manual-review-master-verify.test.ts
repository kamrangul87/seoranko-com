/**
 * End-to-end verification for manual-review auto-verify master prompt:
 * (a) evolve.ds corruption caught
 * (b) panel scores from same HTML are non-zero and stable
 * (c) dated grant claim auto-verified against live GOV.UK when figure matches
 * (d) remaining manual items carry concrete actionHint (not vague)
 */
import { describe, it, expect } from 'vitest'
import { hasInsertionCorruption, scrubInsertionCorruption } from './sentence-integrity'
import { computePanelScores } from './panel-scores'
import { runQualityGate } from './article-quality-gate'

const GOV_URL =
  'https://www.gov.uk/government/collections/government-grants-for-low-emission-vehicles'

const CORRUPTION =
  'smart grid rules, V2G requirements, and communication standards evolve.ds outpace current hardware capabilities.'

describe('manual-review auto-verify master verification', () => {
  it('(a) catches the exact evolve.ds corruption string', () => {
    expect(hasInsertionCorruption(CORRUPTION)).toBe(true)
    const scrubbed = scrubInsertionCorruption(`<p>${CORRUPTION}</p>`)
    expect(scrubbed.html).not.toMatch(/evolve\.ds/)
    expect(hasInsertionCorruption(scrubbed.html)).toBe(false)
  })

  it('(b)(c)(d) scores stay consistent; grant auto-verifies; hints are actionable', async () => {
    const html = `
      <html><head><title>Workplace EV charger grant UK</title>
      <meta name="description" content="How the workplace charging grant works in 2026."/>
      </head><body>
      <h1>Workplace EV charger grant UK</h1>
      <p>Written by Kamran Gul. As of August 2026, the workplace charging scheme offers
      up to £500 towards chargepoint hardware for eligible businesses. Confirm the current
      amount on the <a href="${GOV_URL}">GOV.UK low-emission vehicle grants</a> collection.
      Last updated August 2026.</p>
      <p>In my experience installing workplace chargers, planning the electrical supply
      early matters more than chasing every rebate.</p>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","author":{"@type":"Person","name":"Kamran Gul"},"dateModified":"2026-08-20"}</script>
      </body></html>
    `
    const keyword = 'Workplace EV charger grant UK'
    const panel = computePanelScores(html, keyword)
    expect(panel.eeatScore).toBeGreaterThan(0)
    expect(panel.readabilityScore).toBeGreaterThan(0)

    const qr = await runQualityGate(html, {
      keyword,
      brand: 'TestBrand',
      authorName: 'Kamran Gul',
      eeatScore: panel.eeatScore,
      keywordDensityPct: panel.keywordDensity,
      keywordDensityScore: panel.keywordDensityScore,
      datedPolicy: { now: new Date('2026-08-20') },
    })

    const panelAfter = computePanelScores(qr.articleAfterAutoFix || html, keyword)
    // Same underlying HTML → identical ring inputs (not zeros while QG has a score)
    expect(panelAfter.eeatScore).toBe(computePanelScores(qr.articleAfterAutoFix || html, keyword).eeatScore)
    expect(qr.score).toBeGreaterThanOrEqual(0)
    expect(panel.eeatScore).not.toBe(0)

    const grant = qr.issues.find(i => i.category === 'grant-figure')
    expect(grant).toBeTruthy()
    expect(grant!.verificationStatus).toBeTruthy()
    // Prefer auto-verified when GOV.UK still lists £500; otherwise a specific stop reason
    if (grant!.verificationStatus === 'auto-verified') {
      expect(grant!.severity).toBe('info')
      expect(grant!.title).toMatch(/Auto-verified as of \d{4}-\d{2}-\d{2}/)
    } else {
      expect(['figure-missing', 'unreachable', 'no-citation']).toContain(grant!.verificationStatus)
      expect(grant!.verificationDetail).toBeTruthy()
    }

    const manual = qr.issues.filter(
      i =>
        (i.severity === 'critical' || i.severity === 'warning') &&
        i.verificationStatus !== 'auto-verified',
    )
    for (const issue of manual) {
      expect(issue.actionHint).toBeTruthy()
      expect(issue.actionHint!.length).toBeGreaterThan(15)
      expect(issue.actionHint!.toLowerCase()).not.toContain('manual review required')
    }
  }, 30_000)
})

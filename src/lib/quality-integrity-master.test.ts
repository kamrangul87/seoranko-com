import { describe, it, expect } from 'vitest'
import { toSlug, toSlugPath } from './slug'
import { truncateAtWordBoundary, extractArticleDescription } from './extract-meta-description'
import {
  scrubInsertionCorruption,
  hasInsertionCorruption,
} from './sentence-integrity'
import {
  detectWrongBrandInBody,
  scoreFloorIssues,
  runQualityGate,
} from './article-quality-gate'

describe('slug', () => {
  it('strips trailing hyphens after punctuation-heavy keywords', () => {
    expect(toSlug('dc fast charging-')).toBe('dc-fast-charging')
    expect(toSlugPath('EV charger types comparison (Level 1, 2, DC fast charging)')).not.toMatch(/-$/)
    expect(toSlugPath('EV charger types comparison (Level 1, 2, DC fast charging)')).toMatch(/^\//)
  })
})

describe('truncateAtWordBoundary', () => {
  it('never cuts mid-word', () => {
    const long = 'Practical guide to EV charger types covering Level 1 Level 2 and DC fast charging for UK drivers who want clear costs and options before they buy a wallbox unit today'
    const out = truncateAtWordBoundary(long, 80, true)
    expect(out.endsWith('...')).toBe(true)
    const withoutEllipsis = out.replace(/\.\.\.$/, '').trim()
    const lastWord = withoutEllipsis.split(/\s+/).pop() || ''
    expect(lastWord.length).toBeGreaterThan(1)
    expect(long.toLowerCase().split(/\s+/)).toContain(lastWord.toLowerCase())
  })

  it('extractArticleDescription truncates cleanly', () => {
    const html = `<p>${'charging '.repeat(40)}options available now for every driveway.</p>`
    const desc = extractArticleDescription(html, 'ev charger')
    expect(desc.length).toBeLessThanOrEqual(160)
    expect(desc).not.toMatch(/\band t\.\.\.$/)
  })
})

describe('insertion corruption scrub', () => {
  it('fixes require.ehicles, .350., Document S.t S, installations.ce of', () => {
    expect(hasInsertionCorruption('vehicles require.ehicles need.')).toBe(true)
    expect(hasInsertionCorruption('Approved Document S.t S for charging')).toBe(true)
    expect(hasInsertionCorruption('province of commercial installations.ce of commercial')).toBe(true)

    const scrubbed = scrubInsertionCorruption(
      '<p>vehicles require.ehicles need. Grants of up to £350 (verify at GOV.UK).350. Approved Document S.t S for new points. province of commercial installations.ce of commercial businesses.</p>',
    )
    expect(scrubbed.fixes).toBeGreaterThan(0)
    expect(scrubbed.html).not.toMatch(/require\.ehicles/)
    expect(scrubbed.html).not.toMatch(/\)\.350\./)
    expect(scrubbed.html).not.toMatch(/S\.t S/)
    expect(scrubbed.html).not.toMatch(/installations\.ce of/)
  })
})

describe('brand mismatch + score floors', () => {
  it('flags Auto Trader when brand is Autodun', () => {
    const html = '<p>At auto Trader.com, we explain EV charger types for UK drivers.</p>'
    const issue = detectWrongBrandInBody(html, 'autodun')
    expect(issue?.id).toBe('brand-mismatch')
    expect(issue?.severity).toBe('critical')
  })

  it('does not flag when brand matches', () => {
    const html = '<p>At Autodun, we explain EV charger types for UK drivers.</p>'
    expect(detectWrongBrandInBody(html, 'Autodun')).toBeNull()
  })

  it('score floors: E-E-A-T critical; keyword presence is review heuristic not critical', () => {
    const floors = scoreFloorIssues({
      eeatScore: 40,
      keywordDensityPct: 0,
      keywordDensityScore: 0,
      factSourcingScore: 80,
      keyword: 'ev charger',
    })
    expect(floors.some(i => i.id === 'score-floor-eeat')).toBe(true)
    expect(floors.find(i => i.id === 'score-floor-eeat')?.severity).toBe('critical')
    expect(floors.some(i => i.id === 'score-floor-keyword-density')).toBe(true)
    expect(floors.find(i => i.id === 'score-floor-keyword-density')?.severity).toBe('warning')
  })

  // Confirmed live: an article scored Human Score 60/100 with an explicit
  // "May trigger detection" warning, yet still showed "Ready to publish"
  // at 90/100 overall — human score fed the blended score but had no floor
  // of its own, same class of bug the other floors above exist to close.
  // 72 mirrors humanizer.ts's own passesDetection threshold, not a new
  // number invented here.
  it('score floors block ready when human score is below the detection-risk threshold', () => {
    const floors = scoreFloorIssues({
      eeatScore: 90,
      keywordDensityPct: 2,
      keywordDensityScore: 80,
      factSourcingScore: 80,
      humanScore: 60,
      keyword: 'ev charger',
    })
    expect(floors.some(i => i.id === 'score-floor-human-score')).toBe(true)
    expect(floors.find(i => i.id === 'score-floor-human-score')?.severity).toBe('critical')
  })

  it('does not add a human-score floor issue when the score clears the threshold', () => {
    const floors = scoreFloorIssues({
      eeatScore: 90,
      keywordDensityPct: 2,
      keywordDensityScore: 80,
      factSourcingScore: 80,
      humanScore: 85,
      keyword: 'ev charger',
    })
    expect(floors.some(i => i.id === 'score-floor-human-score')).toBe(false)
  })

  it('runQualityGate auto-fixes Auto Trader and never leaves ready with wrong brand', async () => {
    const html = `
      <h1>EV Charger Types Comparison</h1>
      <p>At auto Trader.com, we explain Level 1, Level 2 and DC fast charging for UK homes. An EV charger types comparison helps drivers choose safely.</p>
      <h2>Level 1</h2><p>Slow charging from a socket.</p>
      <h2>Level 2</h2><p>Home wallbox EV charger types comparison continues here with practical tips.</p>
      <h2>FAQ</h2>
      <div class="faq-item"><h3>What is Level 2?</h3><p>A common home EV charger.</p></div>
      <p>Written by <strong>Kamran Gul</strong>, founder of Autodun.</p>
    `
    const qr = await runQualityGate(html, {
      brand: 'Autodun',
      keyword: 'EV charger types comparison',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['autodun.com'],
      eeatScore: 90,
      keywordDensityPct: 1.2,
      keywordDensityScore: 100,
      factSourcingScore: 90,
    })
    expect(qr.articleAfterAutoFix).toMatch(/Autodun/i)
    expect(qr.articleAfterAutoFix).not.toMatch(/auto\s*trader/i)
    // If mismatch somehow remains, ready must stay false
    if (qr.issues.some(i => i.id === 'brand-mismatch')) {
      expect(qr.readyToPublish).toBe(false)
    }
  })

  it('runQualityGate blocks readyToPublish on score floors', async () => {
    const html = `
      <h1>EV Charger Guide</h1>
      <p>Home charging basics for UK drivers with practical tips and costs.</p>
      <h2>Costs</h2><p>Installation varies by property.</p>
      <p>Written by <strong>Kamran Gul</strong>, founder of Autodun.</p>
    `
    const qr = await runQualityGate(html, {
      brand: 'Autodun',
      keyword: 'ev charger',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['autodun.com'],
      eeatScore: 40,
      keywordDensityPct: 0,
      keywordDensityScore: 0,
      factSourcingScore: 90,
      minWordCount: 10,
    })
    expect(qr.issues.some(i => i.category === 'score-floor')).toBe(true)
    expect(qr.readyToPublish).toBe(false)
  })
})

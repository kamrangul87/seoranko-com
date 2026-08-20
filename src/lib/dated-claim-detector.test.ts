import { describe, it, expect } from 'vitest'
import {
  detectDatedClaims,
  detectStaleYearReferences,
  extractHeadingTexts,
  buildLastVerifiedLine,
  detectTimeAnchoredClaims,
} from './dated-claim-detector'

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

  it('does not flag a historical establishment date in the past', () => {
    const html = '<p>The Office for Zero Emission Vehicles (OZEV) administers the Electric Vehicle Chargepoint Grant (EVCG), introduced in April 2022.</p>'
    const claims = detectDatedClaims(html, now)
    expect(claims.length).toBe(0)
  })

  it('does not flag when GOV.UK official pages are cited in the sentence', () => {
    const html = '<p>As of August 2026, the grant is available to renters and flat owners, according to GOV.UK\'s official EV chargepoint grant pages.</p>'
    const claims = detectDatedClaims(html, now)
    const unsourced = claims.filter(c => !c.hasSource)
    expect(unsourced.length).toBe(0)
  })

  it('does not flag when OZEV is named in a grant policy sentence', () => {
    const html = '<p>As of August 2026, OZEV grant eligibility covers renters but not homeowners with off-street parking.</p>'
    const claims = detectDatedClaims(html, now)
    const unsourced = claims.filter(c => !c.hasSource)
    expect(unsourced.length).toBe(0)
  })

  it('sets a reviewBy date in the future relative to now', () => {
    const html = '<p>As of August 2026, the grant covers 75% of installation costs.</p>'
    const claims = detectDatedClaims(html, now)
    expect(claims.length).toBeGreaterThan(0)
    expect(new Date(claims[0].reviewBy).getTime()).toBeGreaterThan(now.getTime())
  })
})

describe('detectTimeAnchoredClaims', () => {
  const now = new Date('2026-08-13T00:00:00Z')

  it('flags "currently, <figure>" with no parseable date token at all', () => {
    const html = '<p>Currently, the grant covers 75% of installation costs for eligible applicants.</p>'
    const claims = detectTimeAnchoredClaims(html, now)
    expect(claims.some(c => c.matchedPattern === 'currently-quantitative')).toBe(true)
  })

  it('flags "the current rate is <figure>"', () => {
    const html = '<p>The current rate is £350 per household.</p>'
    const claims = detectTimeAnchoredClaims(html, now)
    const claim = claims.find(c => c.matchedPattern === 'current-rate-is')
    expect(claim).toBeTruthy()
    expect(claim!.extractedNumericValue).toBe('£350')
  })

  it('flags "as of <Month> <Year>"', () => {
    const html = '<p>As of August 2026, the scheme is still open to new applicants.</p>'
    const claims = detectTimeAnchoredClaims(html, now)
    expect(claims.some(c => c.matchedPattern === 'as-of-date')).toBe(true)
  })

  it('flags "in <Year>, ... <figure>"', () => {
    const html = '<p>In 2026, the fund distributed £2,000,000 to eligible households.</p>'
    const claims = detectTimeAnchoredClaims(html, now)
    expect(claims.some(c => c.matchedPattern === 'year-quantitative')).toBe(true)
  })

  it('flags "<Month> <Year> update/figures/rates/data"', () => {
    const html = '<p>See the August 2026 figures for a full regional breakdown.</p>'
    const claims = detectTimeAnchoredClaims(html, now)
    expect(claims.some(c => c.matchedPattern === 'month-year-update')).toBe(true)
  })

  it('flags "will rise/fall/increase/change (in|by) <Year>"', () => {
    const html = '<p>The threshold will rise in 2027 following a scheduled review.</p>'
    const claims = detectTimeAnchoredClaims(html, now)
    expect(claims.some(c => c.matchedPattern === 'will-change-by-year')).toBe(true)
  })

  it('does not flag a bare year with no quantitative figure or relative-date phrasing', () => {
    const html = '<p>The charger was installed in 2026 at a residential property.</p>'
    const claims = detectTimeAnchoredClaims(html, now)
    expect(claims).toHaveLength(0)
  })

  it('marks hasOutboundCitationInSentence true when the sentence itself has a link', () => {
    const html = '<p>Currently, the grant covers <a href="https://gov.uk/grants">75% of installation costs</a>.</p>'
    const claims = detectTimeAnchoredClaims(html, now)
    expect(claims.length).toBeGreaterThan(0)
    expect(claims.every(c => c.hasOutboundCitationInSentence)).toBe(true)
  })

  it('marks hasOutboundCitationInSentence false with no link or named source', () => {
    const html = '<p>Currently, the grant covers 75% of installation costs.</p>'
    const claims = detectTimeAnchoredClaims(html, now)
    expect(claims.length).toBeGreaterThan(0)
    expect(claims.every(c => !c.hasOutboundCitationInSentence)).toBe(true)
  })

  it('sets assertedOn to the given now and reviewBy 180 days later', () => {
    const html = '<p>Currently, the grant covers 75% of installation costs.</p>'
    const claims = detectTimeAnchoredClaims(html, now)
    expect(claims[0].assertedOn).toBe('2026-08-13')
    expect(claims[0].reviewBy).toBe('2027-02-09')
  })

  it('extracts a percent or currency figure over a bare number when both are present', () => {
    const html = '<p>The current rate is £350, based on around 1,200 applications this year.</p>'
    const claims = detectTimeAnchoredClaims(html, now)
    const claim = claims.find(c => c.matchedPattern === 'current-rate-is')
    expect(claim!.extractedNumericValue).toBe('£350')
  })
})

describe('extractHeadingTexts', () => {
  it('pulls plain text out of every H2, stripping inline markup', () => {
    const html = '<h2>What Is <strong>CCS</strong> Charging?</h2><p>...</p><h2>Used EV Buyers in 2024</h2>'
    expect(extractHeadingTexts(html)).toEqual(['What Is CCS Charging?', 'Used EV Buyers in 2024'])
  })
})

describe('detectStaleYearReferences', () => {
  // Confirmed live (article da83d673): datePublished/dateModified/"Last
  // verified" all say August 2026, but the H2 heading, its table-of-
  // contents entry, and the meta description all said "used EV buyers in
  // 2024" — two years stale, and never caught because this is a flat wrong
  // year, not an unsourced quantitative claim (detectDatedClaims's domain).
  it('flags a heading year that does not match the publish year', () => {
    const found = detectStaleYearReferences(
      { headings: ['Used EV Buyers in 2024: What You Need to Know'] },
      2026,
    )
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ location: 'heading', year: 2024 })
  })

  it('flags a stale year in the title and meta description too', () => {
    const found = detectStaleYearReferences(
      {
        title: 'EV Buying Guide 2024',
        metaDescription: 'A guide for used EV buyers in 2024.',
      },
      2026,
    )
    const locations = found.map(f => f.location).sort()
    expect(locations).toEqual(['meta-description', 'title'])
  })

  it('does not flag a year that matches the publish year', () => {
    const found = detectStaleYearReferences(
      { title: 'EV Charger Guide 2026', headings: ['What Changed in 2026'] },
      2026,
    )
    expect(found).toHaveLength(0)
  })

  it('does not flag text with no year at all', () => {
    const found = detectStaleYearReferences(
      { title: 'EV Charger Connector Standards Explained', headings: ['Type 2 vs CCS'] },
      2026,
    )
    expect(found).toHaveLength(0)
  })

  it('flags multiple distinct stale years in the same heading separately', () => {
    const found = detectStaleYearReferences(
      { headings: ['EV Sales: 2023 vs 2024 Comparison'] },
      2026,
    )
    expect(found).toHaveLength(2)
    expect(found.map(f => f.year).sort()).toEqual([2023, 2024])
  })
})

describe('buildLastVerifiedLine', () => {
  it('renders a visible line containing a formatted date', () => {
    const line = buildLastVerifiedLine('2026-08-13T00:00:00Z')
    expect(line).toContain('Last verified:')
    expect(line).toContain('2026')
  })
})

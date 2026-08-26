import { describe, it, expect } from 'vitest'
import { detectTemporalClaims, buildTemporalClaimRows } from './temporal-claims'

describe('detectTemporalClaims', () => {
  it('flags "as of <Month> <Year>" co-occurring with a figure and no same-sentence citation', () => {
    const html = '<p>As of August 2026, the grant covers 75% of installation costs.</p>'
    const claims = detectTemporalClaims(html)
    const claim = claims.find(c => c.matchedMarker === 'as-of-month-year')
    expect(claim).toBeTruthy()
    expect(claim!.hasSameSentenceCitation).toBe(false)
    expect(claim!.citationUrl).toBeNull()
  })

  it('flags "currently"', () => {
    const html = '<p>Currently, the threshold is £350 per household.</p>'
    const claims = detectTemporalClaims(html)
    expect(claims.some(c => c.matchedMarker === 'currently')).toBe(true)
  })

  it('flags "at the time of writing"', () => {
    const html = '<p>At the time of writing, the grant covers 75% of costs.</p>'
    const claims = detectTemporalClaims(html)
    expect(claims.some(c => c.matchedMarker === 'at-the-time-of-writing')).toBe(true)
  })

  it('flags "as of today"', () => {
    const html = '<p>As of today, the eligibility threshold is £40,000.</p>'
    const claims = detectTemporalClaims(html)
    expect(claims.some(c => c.matchedMarker === 'as-of-today')).toBe(true)
  })

  it('flags a bare "<Month> <Year>" with no "as of" prefix', () => {
    const html = '<p>August 2026 grant figures show a 75% coverage rate.</p>'
    const claims = detectTemporalClaims(html)
    expect(claims.some(c => c.matchedMarker === 'bare-month-year')).toBe(true)
  })

  it('flags "this year"', () => {
    const html = '<p>This year, the grant covers 75% of installation costs.</p>'
    const claims = detectTemporalClaims(html)
    expect(claims.some(c => c.matchedMarker === 'this-year')).toBe(true)
  })

  it('does not flag a marker with no qualifying figure/policy term (no over-triggering)', () => {
    const html = '<p>Currently, most drivers charge overnight at home.</p>'
    const claims = detectTemporalClaims(html)
    expect(claims).toHaveLength(0)
  })

  it('does not flag a qualifying term with no temporal marker', () => {
    const html = '<p>The grant covers 75% of installation costs for eligible applicants.</p>'
    const claims = detectTemporalClaims(html)
    expect(claims).toHaveLength(0)
  })

  it('recognises deadline/eligibility/limit/threshold as qualifying terms even with no numeric figure', () => {
    const html = '<p>Currently, the application deadline is strict for all applicants.</p>'
    const claims = detectTemporalClaims(html)
    expect(claims.length).toBeGreaterThan(0)
  })

  it('marks hasSameSentenceCitation true only when the link text is in THIS sentence', () => {
    const html = `<p>According to <a href="https://gov.uk/grants">GOV.UK</a>, the scheme exists.
      Currently, the grant covers 75% of installation costs.</p>`
    const claims = detectTemporalClaims(html)
    const claim = claims.find(c => c.matchedMarker === 'currently')
    expect(claim).toBeTruthy()
    // The citation is in the FIRST sentence of the paragraph, not this one.
    expect(claim!.hasSameSentenceCitation).toBe(false)
  })

  it('marks hasSameSentenceCitation true and captures the URL when the citation is in the same sentence', () => {
    const html = '<p>Currently, the grant covers <a href="https://gov.uk/grants">75% of installation costs</a>, according to GOV.UK.</p>'
    const claims = detectTemporalClaims(html)
    const claim = claims.find(c => c.matchedMarker === 'currently')
    expect(claim).toBeTruthy()
    expect(claim!.hasSameSentenceCitation).toBe(true)
    expect(claim!.citationUrl).toBe('https://gov.uk/grants')
  })

  it('does not flag a marker sentence with no figure or policy term at all', () => {
    const html = '<p>The scheme was introduced this year and is easy to apply for online.</p>'
    const claims = detectTemporalClaims(html)
    expect(claims).toHaveLength(0)
  })
})

describe('buildTemporalClaimRows', () => {
  const now = new Date('2026-08-24T00:00:00Z')

  it('registers only claims with a same-sentence citation', () => {
    const html = `
      <p>Currently, the grant covers <a href="https://gov.uk/grants">75% of installation costs</a>.</p>
      <p>Currently, the threshold is £350 per household.</p>
    `
    const claims = detectTemporalClaims(html)
    const rows = buildTemporalClaimRows(claims, { articleId: 'article-1', userId: 'user-1', now })
    expect(rows).toHaveLength(1)
    expect(rows[0].source_url).toBe('https://gov.uk/grants')
    expect(rows[0].claim_text).toContain('75% of installation costs')
  })

  it('sets detected_at to now and review_by to now + 90 days', () => {
    const html = '<p>Currently, the grant covers <a href="https://gov.uk/grants">75% of installation costs</a>.</p>'
    const claims = detectTemporalClaims(html)
    const rows = buildTemporalClaimRows(claims, { articleId: 'article-1', userId: 'user-1', now })
    expect(rows[0].detected_at).toBe('2026-08-24T00:00:00.000Z')
    expect(rows[0].review_by).toBe('2026-11-22T00:00:00.000Z')
    expect(rows[0].status).toBe('active')
  })

  it('dedupes repeated identical cited sentences to one row', () => {
    const html = `
      <p>Currently, the grant covers <a href="https://gov.uk/grants">75% of installation costs</a>.</p>
      <p>Currently, the grant covers <a href="https://gov.uk/grants">75% of installation costs</a>.</p>
    `
    const claims = detectTemporalClaims(html)
    const rows = buildTemporalClaimRows(claims, { articleId: 'article-1', userId: 'user-1', now })
    expect(rows).toHaveLength(1)
  })

  it('returns an empty array when no claim has a same-sentence citation', () => {
    const html = '<p>Currently, the threshold is £350 per household.</p>'
    const claims = detectTemporalClaims(html)
    const rows = buildTemporalClaimRows(claims, { articleId: 'article-1', userId: 'user-1', now })
    expect(rows).toHaveLength(0)
  })
})

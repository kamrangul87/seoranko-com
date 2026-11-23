import { describe, expect, it } from 'vitest'
import { BANNED_CLAIM_WORDS_RE } from './copy-rules'
import { PROOF_SITE_HOST, PROOF_VERIFIED_FIX_COUNT } from './proof-examples'
import {
  AUTODUN_CASE_STUDY_COPY,
  AUTODUN_GSC_WEEKLY_IMPRESSIONS,
  autodunCaseStudyArticleJsonLd,
  collectCaseStudyCopyStrings,
} from './case-study-autodun'

describe('autodun.com case study facts', () => {
  it('reuses the production-verified fix count and host from proof-examples', () => {
    expect(PROOF_VERIFIED_FIX_COUNT).toBe(14)
    expect(PROOF_SITE_HOST).toBe('autodun.com')
    expect(AUTODUN_CASE_STUDY_COPY.verifiedFixesLine).toBe(
      `${PROOF_VERIFIED_FIX_COUNT} production-verified fixes on ${PROOF_SITE_HOST}`,
    )
    expect(AUTODUN_CASE_STUDY_COPY.siteKind).toMatch(/UK motoring/i)
  })

  it('records the verified Search Console weekly impression series', () => {
    expect(AUTODUN_GSC_WEEKLY_IMPRESSIONS).toEqual([
      { weekOf: '2026-10-19', impressions: 322 },
      { weekOf: '2026-10-26', impressions: 355 },
      { weekOf: '2026-11-02', impressions: 680 },
      { weekOf: '2026-11-09', impressions: 1040 },
      { weekOf: '2026-11-16', impressions: 1414, partial: true },
    ])
    expect(AUTODUN_CASE_STUDY_COPY.clicksCaveat.toLowerCase()).toMatch(/clicks/)
    expect(AUTODUN_CASE_STUDY_COPY.clicksCaveat.toLowerCase()).toMatch(/page 1/)
    expect(AUTODUN_CASE_STUDY_COPY.earlyProgressLine.toLowerCase()).toMatch(/early progress/)
  })

  it('does not use banned claim words including traffic', () => {
    for (const s of collectCaseStudyCopyStrings()) {
      expect(s).not.toMatch(BANNED_CLAIM_WORDS_RE)
      expect(s).not.toMatch(/\btraffic\b/i)
    }
  })

  it('emits Article JSON-LD for the case study URL', () => {
    const schema = autodunCaseStudyArticleJsonLd()
    expect(schema['@context']).toBe('https://schema.org')
    expect(schema['@type']).toBe('Article')
    expect(schema.url).toBe('https://www.seoranko.com/case-studies/autodun')
    expect(schema.headline).toBeTruthy()
    expect(schema.author).toEqual({ '@type': 'Person', name: 'Kamran' })
    expect(schema.publisher).toMatchObject({
      '@type': 'Organization',
      name: 'SEORANKO',
      url: 'https://www.seoranko.com',
    })
  })
})

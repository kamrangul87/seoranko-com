import type { Article, Organization, Person, WithContext } from 'schema-dts'
import { ABOUT_COPY } from './about-copy'
import { SITE_ORIGIN, absoluteUrl } from './public-site'
import { PROOF_SITE_HOST, PROOF_VERIFIED_FIX_COUNT } from './proof-examples'

const CASE_STUDY_PATH = '/case-studies/autodun'

export type GscWeeklyImpressions = {
  weekOf: string
  impressions: number
  partial?: true
}

/**
 * Verified Google Search Console weekly impression totals for autodun.com.
 * Weeks of 19 Oct 2026 through 16 Nov 2026 (last week partial).
 */
export const AUTODUN_GSC_WEEKLY_IMPRESSIONS: readonly GscWeeklyImpressions[] = [
  { weekOf: '2026-10-19', impressions: 322 },
  { weekOf: '2026-10-26', impressions: 355 },
  { weekOf: '2026-11-02', impressions: 680 },
  { weekOf: '2026-11-09', impressions: 1040 },
  { weekOf: '2026-11-16', impressions: 1414, partial: true },
]

export const AUTODUN_CASE_STUDY_COPY = {
  headline: 'autodun.com — early case study',
  metaDescription: `${PROOF_VERIFIED_FIX_COUNT} production-verified fixes on ${PROOF_SITE_HOST}, a UK motoring site. Search Console weekly impressions grew from 322 to 1,414; clicks are still very low. Early progress, not a visits claim.`,
  description:
    'An early look at autodun.com, a UK motoring site: production-verified technical fixes, and Search Console impression totals that are still small.',
  siteKind: 'autodun.com is a UK motoring site.',
  verifiedFixesLine: `${PROOF_VERIFIED_FIX_COUNT} production-verified fixes on ${PROOF_SITE_HOST}`,
  gscHeading: 'Search Console impressions',
  gscIntro: 'Google Search Console weekly impressions:',
  fixesHeading: 'Production-verified fixes',
  shippedPrefix: 'SEORANKO shipped',
  clicksCaveat:
    'Clicks are still very low, and most pages sit beyond page 1 in Google results so far.',
  earlyProgressLine:
    'This is early progress — not a claim that search visits have taken off.',
  datePublished: '2026-11-23',
} as const

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatWeekOf(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d || m < 1 || m > 12) return isoDate
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export function formatImpressions(n: number): string {
  return n.toLocaleString('en-GB')
}

export function collectCaseStudyCopyStrings(): string[] {
  return [
    AUTODUN_CASE_STUDY_COPY.headline,
    AUTODUN_CASE_STUDY_COPY.metaDescription,
    AUTODUN_CASE_STUDY_COPY.description,
    AUTODUN_CASE_STUDY_COPY.siteKind,
    AUTODUN_CASE_STUDY_COPY.verifiedFixesLine,
    AUTODUN_CASE_STUDY_COPY.gscHeading,
    AUTODUN_CASE_STUDY_COPY.gscIntro,
    AUTODUN_CASE_STUDY_COPY.fixesHeading,
    AUTODUN_CASE_STUDY_COPY.shippedPrefix,
    AUTODUN_CASE_STUDY_COPY.clicksCaveat,
    AUTODUN_CASE_STUDY_COPY.earlyProgressLine,
    ...AUTODUN_GSC_WEEKLY_IMPRESSIONS.map((row) => String(row.impressions)),
  ]
}

export function autodunCaseStudyArticleJsonLd(): WithContext<Article> {
  const url = absoluteUrl(CASE_STUDY_PATH)
  const author: Person = { '@type': 'Person', name: ABOUT_COPY.founderName }
  const publisher: Organization = {
    '@type': 'Organization',
    name: 'SEORANKO',
    url: SITE_ORIGIN,
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: AUTODUN_CASE_STUDY_COPY.headline,
    description: AUTODUN_CASE_STUDY_COPY.description,
    datePublished: AUTODUN_CASE_STUDY_COPY.datePublished,
    dateModified: AUTODUN_CASE_STUDY_COPY.datePublished,
    url,
    inLanguage: 'en-GB',
    author,
    publisher,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    about: {
      '@type': 'Organization',
      name: PROOF_SITE_HOST,
      url: `https://${PROOF_SITE_HOST}`,
    },
  }
}

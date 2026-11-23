import type { Metadata } from 'next'
import { AUTH_ROBOTS, SITE_ORIGIN, publicPageMetadata } from '@/lib/public-site'
import { ABOUT_COPY } from '@/lib/about-copy'
import { AUTODUN_CASE_STUDY_COPY } from '@/lib/case-study-autodun'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'
import { SEORANKO_FREE_PLAN, SEORANKO_PLANS } from '@/lib/stripe/plans'
import { PROOF_SITE_HOST } from '@/lib/proof-examples'

const HOME_TITLE =
  'SEORANKO — Find, fix and verify the technical problems blocking Google indexing'
const HOME_DESCRIPTION =
  'SEORANKO finds technical problems that stop Google indexing your site, fixes them in your code, and proves each fix is live.'

export const HOME_METADATA: Metadata = publicPageMetadata({
  path: '/',
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
})

/**
 * Root document metadata — positioning source: docs/POSITIONING.md.
 * metadataBase is https://www.seoranko.com (apex 308s to www). Path-specific
 * canonicals live on each public page so children do not inherit the homepage
 * canonical.
 */
export const ROOT_METADATA: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  openGraph: {
    title: HOME_TITLE,
    description:
      'Finds technical indexing problems, fixes them in your code, and proves each fix is live.',
    type: 'website',
    siteName: 'SEORANKO',
  },
  twitter: {
    card: 'summary_large_image',
    title: HOME_TITLE,
    description:
      'Finds technical indexing problems, fixes them in your code, and proves each fix is live.',
  },
}

export const PRICING_METADATA: Metadata = publicPageMetadata({
  path: '/pricing',
  title: 'Pricing — SEORANKO',
  description: `${SEORANKO_FREE_PLAN.label} ${SEORANKO_FREE_PLAN.priceDisplay} detect-only audits (${FIX_STRATEGY_PRODUCT_DECISIONS.crawlPagesPerRunFree} pages). ${SEORANKO_PLANS.seoranko_starter.label} ${SEORANKO_PLANS.seoranko_starter.priceDisplay}, ${SEORANKO_PLANS.seoranko_pro.label} ${SEORANKO_PLANS.seoranko_pro.priceDisplay}, ${SEORANKO_PLANS.seoranko_agency.label} ${SEORANKO_PLANS.seoranko_agency.priceDisplay}. Paid plans share the same features; they differ by pages per crawl.`,
})

export const ABOUT_METADATA: Metadata = publicPageMetadata({
  path: '/about',
  title: ABOUT_COPY.title,
  description: ABOUT_COPY.metaDescription,
})

export const AUTODUN_CASE_STUDY_METADATA: Metadata = publicPageMetadata({
  path: '/case-studies/autodun',
  title: `${PROOF_SITE_HOST} case study — SEORANKO`,
  description: AUTODUN_CASE_STUDY_COPY.metaDescription,
  ogType: 'article',
})

export const BOT_METADATA: Metadata = publicPageMetadata({
  path: '/bot',
  title: 'SEORANKOBot — Crawler info',
  description: 'What SEORANKOBot does and how to block it via robots.txt',
})

export const INDEX_DIAGNOSIS_METADATA: Metadata = publicPageMetadata({
  path: '/tools/index-diagnosis',
  title: 'Index Diagnosis — Free indexing crawl | SEORANKO',
  description:
    'Enter a domain and get the top mechanical reasons pages may not be indexed — robots, noindex, canonicals, orphans, and more.',
})

export const LOGIN_METADATA: Metadata = {
  ...publicPageMetadata({
    path: '/login',
    title: 'Log in — SEORANKO',
    description:
      'Log in to SEORANKO to crawl your site, review findings, and verify live fixes.',
  }),
  robots: AUTH_ROBOTS,
}

export const SIGNUP_METADATA: Metadata = {
  ...publicPageMetadata({
    path: '/signup',
    title: 'Sign up — SEORANKO',
    description:
      'Create a free SEORANKO account for detect-only site audits. No credit card required.',
  }),
  robots: AUTH_ROBOTS,
}

export const FORGOT_PASSWORD_METADATA: Metadata = {
  ...publicPageMetadata({
    path: '/forgot-password',
    title: 'Forgot password — SEORANKO',
    description: 'Reset your SEORANKO account password.',
  }),
  robots: AUTH_ROBOTS,
}

export const RESET_PASSWORD_METADATA: Metadata = {
  ...publicPageMetadata({
    path: '/reset-password',
    title: 'Reset password — SEORANKO',
    description: 'Set a new password for your SEORANKO account.',
  }),
  robots: AUTH_ROBOTS,
}

export const REPORT_METADATA: Metadata = {
  title: 'Fix report — SEORANKO',
  description:
    'Read-only SEORANKO report of findings detected, fixes applied, and live verification results.',
  robots: { index: false, follow: false },
}

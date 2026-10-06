import type { Metadata } from 'next'

/**
 * Root document metadata — positioning source: docs/POSITIONING.md.
 * Imported by src/app/layout.tsx and by the public-copy guard test.
 */
export const ROOT_METADATA: Metadata = {
  metadataBase: new URL('https://www.seoranko.com'),
  title:
    'SEORANKO — Find, fix and verify the technical problems blocking Google indexing',
  description:
    'SEORANKO finds technical problems that stop Google indexing your site, fixes them in your code, and proves each fix is live.',
  openGraph: {
    title:
      'SEORANKO — Find, fix and verify the technical problems blocking Google indexing',
    description:
      'Finds technical indexing problems, fixes them in your code, and proves each fix is live.',
    type: 'website',
    url: 'https://www.seoranko.com',
  },
  twitter: {
    card: 'summary',
    title:
      'SEORANKO — Find, fix and verify the technical problems blocking Google indexing',
    description:
      'Finds technical indexing problems, fixes them in your code, and proves each fix is live.',
  },
}

export const LOGIN_METADATA: Metadata = {
  title: 'Log in — SEORANKO',
  description:
    'Log in to SEORANKO to crawl your site, review findings, and verify live fixes.',
}

export const SIGNUP_METADATA: Metadata = {
  title: 'Sign up — SEORANKO',
  description:
    'Create a free SEORANKO account for detect-only site audits. No credit card required.',
}

export const REPORT_METADATA: Metadata = {
  title: 'Fix report — SEORANKO',
  description:
    'Read-only SEORANKO report of findings detected, fixes applied, and live verification results.',
  robots: { index: false, follow: false },
}

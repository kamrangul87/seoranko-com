/**
 * CLAUSE_LIBRARY_VERSION=1
 * human-reviewed text — do not generate or rewrite with a model
 */

import { CLAUSE_LIBRARY_VERSION } from './version'

export { CLAUSE_LIBRARY_VERSION }

export type VendorClause = {
  vendorId: string
  body: string
}

/** One fixed clause per seeded vendor. Placeholders: none required beyond name in text. */
export const VENDOR_CLAUSES: readonly VendorClause[] = [
  {
    vendorId: 'ga4_gtag',
    body:
      'Google Analytics 4 (gtag.js) — used to measure site usage. Processor location: United States (Google LLC). ' +
      'Privacy information: https://policies.google.com/privacy',
  },
  {
    vendorId: 'gtm',
    body:
      'Google Tag Manager — used to manage measurement and marketing tags. Processor location: United States (Google LLC). ' +
      'Privacy information: https://policies.google.com/privacy',
  },
  {
    vendorId: 'meta_pixel',
    body:
      'Meta Pixel — used for advertising measurement and conversion tracking. Processor location: United States (Meta Platforms). ' +
      'Privacy information: https://www.facebook.com/privacy/policy/',
  },
  {
    vendorId: 'hotjar',
    body:
      'Hotjar — used for aggregated behaviour analytics (e.g. heatmaps / session insights). Processor location: Malta / EU (Hotjar Ltd). ' +
      'Privacy information: https://www.hotjar.com/legal/policies/privacy/',
  },
  {
    vendorId: 'ms_clarity',
    body:
      'Microsoft Clarity — used for aggregated behaviour analytics. Processor location: United States (Microsoft). ' +
      'Privacy information: https://privacy.microsoft.com/privacystatement',
  },
  {
    vendorId: 'formspree',
    body:
      'Formspree — used to process form submissions you send us. Processor location: United States (Formspree, Inc.). ' +
      'Privacy information: https://formspree.io/legal/privacy-policy',
  },
  {
    vendorId: 'stripe',
    body:
      'Stripe — used to process payments. Processor location: United States / EU (Stripe, Inc.). ' +
      'Privacy information: https://stripe.com/privacy',
  },
  {
    vendorId: 'google_maps',
    body:
      'Google Maps — used to display maps / location embeds. Processor location: United States (Google LLC). ' +
      'Privacy information: https://policies.google.com/privacy',
  },
  {
    vendorId: 'youtube',
    body:
      'YouTube — used to embed video content. Processor location: United States (Google LLC). ' +
      'Privacy information: https://policies.google.com/privacy',
  },
  {
    vendorId: 'recaptcha',
    body:
      'Google reCAPTCHA — used to help prevent abuse of forms. Processor location: United States (Google LLC). ' +
      'Privacy information: https://policies.google.com/privacy',
  },
  {
    vendorId: 'vercel',
    body:
      'Vercel — used to host and deliver this website (and related platform analytics where enabled). ' +
      'Processor location: United States (Vercel Inc.). Privacy information: https://vercel.com/legal/privacy-policy',
  },
  {
    vendorId: 'netlify',
    body:
      'Netlify — used to host and deliver this website. Processor location: United States (Netlify, Inc.). ' +
      'Privacy information: https://www.netlify.com/privacy/',
  },
  {
    vendorId: 'cloudflare',
    body:
      'Cloudflare — used for CDN, security, and related platform services. Processor location: United States (Cloudflare, Inc.). ' +
      'Privacy information: https://www.cloudflare.com/privacypolicy/',
  },
] as const

export function vendorClauseById(id: string): VendorClause | undefined {
  return VENDOR_CLAUSES.find((c) => c.vendorId === id)
}

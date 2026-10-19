/**
 * Static third-party vendor signatures for Privacy & Consent (topic 72).
 * Match patterns are deterministic — no model calls.
 */

export type VendorCategory =
  | 'analytics'
  | 'ads'
  | 'forms'
  | 'payments'
  | 'embeds'
  | 'hosting'

export type VendorMatchKind = 'script_src' | 'form_action' | 'iframe_src' | 'cookie_name'

export type VendorSignature = {
  id: string
  displayName: string
  category: VendorCategory
  requiresConsent: boolean
  processorLocation: string
  privacyUrl: string
  /** Brand aliases that count as "named" on a privacy page. */
  nameAliases: string[]
  patterns: Array<{ kind: VendorMatchKind; pattern: RegExp }>
}

/**
 * Seed table. Each entry cites the vendor's public docs for the match pattern.
 */
export const VENDOR_SIGNATURES: readonly VendorSignature[] = [
  // https://developers.google.com/tag-platform/gtagjs/install
  {
    id: 'ga4_gtag',
    displayName: 'Google Analytics 4 (gtag.js)',
    category: 'analytics',
    requiresConsent: true,
    processorLocation: 'United States (Google LLC)',
    privacyUrl: 'https://policies.google.com/privacy',
    nameAliases: ['google analytics', 'ga4', 'gtag', 'google tag'],
    patterns: [
      { kind: 'script_src', pattern: /googletagmanager\.com\/gtag\/js/i },
      { kind: 'script_src', pattern: /www\.google-analytics\.com\/analytics\.js/i },
      { kind: 'cookie_name', pattern: /^_ga($|_)/i },
      { kind: 'cookie_name', pattern: /^_gid$/i },
    ],
  },
  // https://developers.google.com/tag-platform/tag-manager/web
  {
    id: 'gtm',
    displayName: 'Google Tag Manager',
    category: 'analytics',
    requiresConsent: true,
    processorLocation: 'United States (Google LLC)',
    privacyUrl: 'https://policies.google.com/privacy',
    nameAliases: ['google tag manager', 'gtm'],
    patterns: [
      { kind: 'script_src', pattern: /googletagmanager\.com\/gtm\.js/i },
      { kind: 'iframe_src', pattern: /googletagmanager\.com\/ns\.html/i },
      { kind: 'cookie_name', pattern: /^_gcl_/i },
    ],
  },
  // https://developers.facebook.com/docs/meta-pixel/get-started
  {
    id: 'meta_pixel',
    displayName: 'Meta Pixel',
    category: 'ads',
    requiresConsent: true,
    processorLocation: 'United States (Meta Platforms)',
    privacyUrl: 'https://www.facebook.com/privacy/policy/',
    nameAliases: ['meta pixel', 'facebook pixel', 'meta'],
    patterns: [
      { kind: 'script_src', pattern: /connect\.facebook\.net\/.*\/fbevents\.js/i },
      { kind: 'cookie_name', pattern: /^_fbp$/i },
      { kind: 'cookie_name', pattern: /^_fbc$/i },
    ],
  },
  // https://help.hotjar.com/hc/en-us/articles/115011639927
  {
    id: 'hotjar',
    displayName: 'Hotjar',
    category: 'analytics',
    requiresConsent: true,
    processorLocation: 'Malta / EU (Hotjar Ltd)',
    privacyUrl: 'https://www.hotjar.com/legal/policies/privacy/',
    nameAliases: ['hotjar'],
    patterns: [
      { kind: 'script_src', pattern: /static\.hotjar\.com/i },
      { kind: 'script_src', pattern: /script\.hotjar\.com/i },
      { kind: 'cookie_name', pattern: /^_hj/i },
    ],
  },
  // https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup
  {
    id: 'ms_clarity',
    displayName: 'Microsoft Clarity',
    category: 'analytics',
    requiresConsent: true,
    processorLocation: 'United States (Microsoft)',
    privacyUrl: 'https://privacy.microsoft.com/privacystatement',
    nameAliases: ['microsoft clarity', 'clarity'],
    patterns: [
      { kind: 'script_src', pattern: /clarity\.ms\/tag/i },
      { kind: 'cookie_name', pattern: /^_clck$/i },
      { kind: 'cookie_name', pattern: /^_clsk$/i },
    ],
  },
  // https://help.formspree.io/hc/en-us/articles/360053249013
  {
    id: 'formspree',
    displayName: 'Formspree',
    category: 'forms',
    requiresConsent: false,
    processorLocation: 'United States (Formspree, Inc.)',
    privacyUrl: 'https://formspree.io/legal/privacy-policy',
    nameAliases: ['formspree'],
    patterns: [
      { kind: 'form_action', pattern: /formspree\.io\/f\//i },
      { kind: 'script_src', pattern: /formspree\.io/i },
    ],
  },
  // https://stripe.com/docs/js
  {
    id: 'stripe',
    displayName: 'Stripe',
    category: 'payments',
    requiresConsent: false,
    processorLocation: 'United States / EU (Stripe, Inc.)',
    privacyUrl: 'https://stripe.com/privacy',
    nameAliases: ['stripe'],
    patterns: [
      { kind: 'script_src', pattern: /js\.stripe\.com/i },
      { kind: 'iframe_src', pattern: /js\.stripe\.com/i },
      { kind: 'cookie_name', pattern: /^__stripe_/i },
    ],
  },
  // https://developers.google.com/maps/documentation/javascript/load-maps-js-api
  {
    id: 'google_maps',
    displayName: 'Google Maps',
    category: 'embeds',
    requiresConsent: true,
    processorLocation: 'United States (Google LLC)',
    privacyUrl: 'https://policies.google.com/privacy',
    nameAliases: ['google maps', 'maps.google'],
    patterns: [
      { kind: 'script_src', pattern: /maps\.googleapis\.com/i },
      { kind: 'iframe_src', pattern: /google\.com\/maps\/embed/i },
    ],
  },
  // https://developers.google.com/youtube/iframe_api_reference
  {
    id: 'youtube',
    displayName: 'YouTube',
    category: 'embeds',
    requiresConsent: true,
    processorLocation: 'United States (Google LLC)',
    privacyUrl: 'https://policies.google.com/privacy',
    nameAliases: ['youtube'],
    patterns: [
      { kind: 'iframe_src', pattern: /youtube\.com\/embed\//i },
      { kind: 'iframe_src', pattern: /youtube-nocookie\.com\/embed\//i },
      { kind: 'script_src', pattern: /youtube\.com\/iframe_api/i },
    ],
  },
  // https://developers.google.com/recaptcha/docs/v3
  {
    id: 'recaptcha',
    displayName: 'Google reCAPTCHA',
    category: 'forms',
    requiresConsent: true,
    processorLocation: 'United States (Google LLC)',
    privacyUrl: 'https://policies.google.com/privacy',
    nameAliases: ['recaptcha', 're captcha'],
    patterns: [
      { kind: 'script_src', pattern: /google\.com\/recaptcha/i },
      { kind: 'script_src', pattern: /gstatic\.com\/recaptcha/i },
      { kind: 'iframe_src', pattern: /google\.com\/recaptcha/i },
    ],
  },
  // https://vercel.com/docs/analytics
  {
    id: 'vercel',
    displayName: 'Vercel',
    category: 'hosting',
    requiresConsent: false,
    processorLocation: 'United States (Vercel Inc.)',
    privacyUrl: 'https://vercel.com/legal/privacy-policy',
    nameAliases: ['vercel'],
    patterns: [
      { kind: 'script_src', pattern: /va\.vercel-scripts\.com/i },
      { kind: 'script_src', pattern: /vercel\.live/i },
      { kind: 'cookie_name', pattern: /^__vercel/i },
    ],
  },
  // https://docs.netlify.com/manage/monitoring/analytics/
  {
    id: 'netlify',
    displayName: 'Netlify',
    category: 'hosting',
    requiresConsent: false,
    processorLocation: 'United States (Netlify, Inc.)',
    privacyUrl: 'https://www.netlify.com/privacy/',
    nameAliases: ['netlify'],
    patterns: [
      { kind: 'script_src', pattern: /netlify\.com\/.*analytics/i },
      { kind: 'cookie_name', pattern: /^nf_/i },
    ],
  },
  // https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/
  {
    id: 'cloudflare',
    displayName: 'Cloudflare',
    category: 'hosting',
    requiresConsent: false,
    processorLocation: 'United States (Cloudflare, Inc.)',
    privacyUrl: 'https://www.cloudflare.com/privacypolicy/',
    nameAliases: ['cloudflare'],
    patterns: [
      { kind: 'script_src', pattern: /cdn-cgi\/challenge|cloudflareinsights\.com|challenges\.cloudflare\.com\/turnstile/i },
      { kind: 'cookie_name', pattern: /^__cf/i },
      { kind: 'cookie_name', pattern: /^cf_/i },
    ],
  },
] as const

export function vendorById(id: string): VendorSignature | undefined {
  return VENDOR_SIGNATURES.find((v) => v.id === id)
}

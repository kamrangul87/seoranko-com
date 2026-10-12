import { describe, expect, it } from 'vitest'
import { VENDOR_SIGNATURES } from './vendor-signatures'
import {
  extractPageSignals,
  matchVendorAgainstValue,
  matchVendorsOnPage,
} from './extract-signals'

/** One representative match value per seeded vendor. */
const SEED_MATCHES: Record<
  string,
  { kind: 'script_src' | 'form_action' | 'iframe_src' | 'cookie_name'; value: string }
> = {
  ga4_gtag: {
    kind: 'script_src',
    value: 'https://www.googletagmanager.com/gtag/js?id=G-XXXX',
  },
  gtm: {
    kind: 'script_src',
    value: 'https://www.googletagmanager.com/gtm.js?id=GTM-XXXX',
  },
  meta_pixel: {
    kind: 'script_src',
    value: 'https://connect.facebook.net/en_US/fbevents.js',
  },
  hotjar: {
    kind: 'script_src',
    value: 'https://static.hotjar.com/c/hotjar-123.js',
  },
  ms_clarity: {
    kind: 'script_src',
    value: 'https://www.clarity.ms/tag/abcdef',
  },
  formspree: {
    kind: 'form_action',
    value: 'https://formspree.io/f/xyzabc',
  },
  stripe: {
    kind: 'script_src',
    value: 'https://js.stripe.com/v3/',
  },
  google_maps: {
    kind: 'script_src',
    value: 'https://maps.googleapis.com/maps/api/js?key=x',
  },
  youtube: {
    kind: 'iframe_src',
    value: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
  },
  recaptcha: {
    kind: 'script_src',
    value: 'https://www.google.com/recaptcha/api.js',
  },
  vercel: {
    kind: 'script_src',
    value: 'https://va.vercel-scripts.com/v1/script.js',
  },
  netlify: {
    kind: 'cookie_name',
    value: 'nf_jwt',
  },
  cloudflare: {
    kind: 'cookie_name',
    value: '__cf_bm',
  },
}

describe('vendor signature matching', () => {
  it('seeds every required vendor id', () => {
    const ids = VENDOR_SIGNATURES.map((v) => v.id)
    expect(ids.sort()).toEqual(
      [
        'cloudflare',
        'formspree',
        'ga4_gtag',
        'google_maps',
        'gtm',
        'hotjar',
        'meta_pixel',
        'ms_clarity',
        'netlify',
        'recaptcha',
        'stripe',
        'vercel',
        'youtube',
      ].sort(),
    )
  })

  it.each(Object.entries(SEED_MATCHES))(
    'matches %s against its seed value',
    (id, sample) => {
      const vendor = VENDOR_SIGNATURES.find((v) => v.id === id)
      expect(vendor).toBeTruthy()
      expect(
        matchVendorAgainstValue(vendor!, sample.kind, sample.value),
      ).toBe(true)
    },
  )

  it('detects GA4 from a page with gtag script src', () => {
    const html = `<html><head>
      <script src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>
    </head><body></body></html>`
    const signals = extractPageSignals('https://example.com/', html)
    const hits = matchVendorsOnPage(signals)
    expect(hits.some((h) => h.vendor.id === 'ga4_gtag')).toBe(true)
  })
})

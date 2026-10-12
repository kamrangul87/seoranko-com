/**
 * Deterministic consent-signal detection from static HTML only.
 * Never assumes compliant when undeterminable.
 */

export type ConsentPresence =
  | 'cmp_signature'
  | 'gated_analytics'
  | 'absent'
  | 'unknown'

export type ConsentSignal = {
  presence: ConsentPresence
  /** CMP vendor id when matched, else null. */
  cmpId: string | null
  /**
   * Whether analytics/ads scripts appear to load before any consent gate.
   * Static HTML cannot prove post-consent injection → "unknown" is allowed.
   */
  preConsentLoad: 'yes' | 'no' | 'unknown'
  detail: string
}

/** Known CMP script/DOM signatures (static HTML). */
const CMP_SIGNATURES: Array<{ id: string; pattern: RegExp }> = [
  // https://docs.cookiebot.com/en/articles/9689975-manual-implementation
  { id: 'cookiebot', pattern: /consent\.cookiebot\.com|Cookiebot/i },
  // https://community.cookieyes.com/article/how-to-install-cookieyes
  { id: 'cookieyes', pattern: /cdn-cookieyes\.com|cookieyes/i },
  // https://developer.onetrust.com/
  { id: 'onetrust', pattern: /cdn\.cookielaw\.org|OneTrust|otSDKStub/i },
  // https://www.osano.com/cookieconsent/documentation/javascript-api/
  { id: 'osano', pattern: /osano\.com\/ccm|cookieconsent/i },
  // https://help.quantcast.com/hc/en-us/articles/360003814594
  { id: 'quantcast', pattern: /quantcast\.mgr\.consensu\.org|__cmp/i },
  // https://support.iubenda.com/hc/en-us/articles/211914141
  { id: 'iubenda', pattern: /cdn\.iubenda\.com|iubenda/i },
  // https://www.termsfeed.com/blog/cookie-consent/
  { id: 'termsfeed', pattern: /termsfeed\.com\/public\/cookie-consent/i },
]

/** Patterns suggesting a script is only loaded after a consent check. */
const GATED_LOAD_PATTERNS: RegExp[] = [
  /consent\.granted|analytics_storage['"]?\s*:\s*['"]granted/i,
  /gtag\s*\(\s*['"]consent['"]/i,
  /if\s*\([^)]*consent[^)]*\)\s*\{[^}]{0,400}(?:gtag|googletagmanager|fbevents)/i,
  /loadScript\s*\([^)]*(?:gtag|googletagmanager)/i,
]

/** Consent-requiring vendor markers that, if present as bare script src, imply pre-consent load. */
const PRE_CONSENT_VENDOR_SRC =
  /googletagmanager\.com\/(?:gtag\/js|gtm\.js)|connect\.facebook\.net\/.*\/fbevents\.js|clarity\.ms\/tag|static\.hotjar\.com|script\.hotjar\.com/i

export function detectConsentSignal(html: string): ConsentSignal {
  for (const cmp of CMP_SIGNATURES) {
    if (cmp.pattern.test(html)) {
      const hasBareVendor = PRE_CONSENT_VENDOR_SRC.test(html)
      return {
        presence: 'cmp_signature',
        cmpId: cmp.id,
        // CMP present but vendor also in initial HTML → still may load pre-consent
        preConsentLoad: hasBareVendor ? 'yes' : 'unknown',
        detail: `CMP signature matched: ${cmp.id}`,
      }
    }
  }

  const gated = GATED_LOAD_PATTERNS.some((re) => re.test(html))
  const bareVendor = PRE_CONSENT_VENDOR_SRC.test(html)

  if (gated && !bareVendor) {
    return {
      presence: 'gated_analytics',
      cmpId: null,
      preConsentLoad: 'no',
      detail: 'Analytics load appears gated behind a consent check; no bare vendor script src in HTML',
    }
  }

  if (bareVendor) {
    return {
      presence: 'absent',
      cmpId: null,
      preConsentLoad: 'yes',
      detail:
        'Consent-requiring vendor script present in initial HTML with no CMP signature',
    }
  }

  if (gated) {
    return {
      presence: 'gated_analytics',
      cmpId: null,
      preConsentLoad: 'unknown',
      detail:
        'Consent-gating patterns found alongside vendor markers — pre_consent_load undeterminable from static HTML',
    }
  }

  return {
    presence: 'unknown',
    cmpId: null,
    preConsentLoad: 'unknown',
    detail:
      'No CMP signature and no consent-requiring vendor script in initial HTML — pre_consent_load: unknown',
  }
}

/** Site-level rollup: worst-case across pages. */
export function rollupConsentSignals(signals: ConsentSignal[]): ConsentSignal {
  if (signals.length === 0) {
    return {
      presence: 'unknown',
      cmpId: null,
      preConsentLoad: 'unknown',
      detail: 'No pages inspected',
    }
  }
  const withCmp = signals.find((s) => s.presence === 'cmp_signature')
  if (withCmp) {
    const anyPreYes = signals.some((s) => s.preConsentLoad === 'yes')
    return {
      ...withCmp,
      preConsentLoad: anyPreYes ? 'yes' : withCmp.preConsentLoad,
    }
  }
  const absent = signals.find((s) => s.presence === 'absent')
  if (absent) return absent
  const gated = signals.find((s) => s.presence === 'gated_analytics')
  if (gated) return gated
  return signals[0]!
}

import { describe, expect, it } from 'vitest'
import { detectPrivacyConsentIssues } from './detect'

const ORIGIN = 'https://example.com'

const POLICY_WITHOUT_GOOGLE = `<!doctype html>
<html><body>
<footer><a href="/privacy">Privacy Policy</a></footer>
<h1>Privacy</h1>
<p>We are the data controller. Contact us at privacy@example.com.</p>
<p>Lawful basis: legitimate interests. Recipients: hosting providers.</p>
<p>International transfers use standard contractual clauses.</p>
<p>Retention: 12 months. Your rights include access and the right to complain to a supervisory authority. You may withdraw consent.</p>
</body></html>`

const HOME_WITH_GA = `<!doctype html>
<html><head>
<script src="https://www.googletagmanager.com/gtag/js?id=G-TEST123"></script>
</head><body>
<footer><a href="/privacy">Privacy Policy</a></footer>
</body></html>`

describe('topic 72 privacy consent', () => {
  it('emits vendor-unnamed (b) when GA loads and policy omits Google', () => {
    const result = detectPrivacyConsentIssues({
      originUrl: ORIGIN,
      jurisdiction: 'UK',
      pages: [
        { url: `${ORIGIN}/`, html: HOME_WITH_GA },
        { url: `${ORIGIN}/privacy`, html: POLICY_WITHOUT_GOOGLE },
      ],
    })
    const unnamed = result.findings.filter(
      (f) => f.verdict === 'human-review-vendor-unnamed',
    )
    expect(unnamed.length).toBeGreaterThanOrEqual(1)
    expect(unnamed.some((f) => f.evidenceValues.vendorId === 'ga4_gtag')).toBe(
      true,
    )
  })

  it('emits consent-missing (c) for GA without CMP/gated load', () => {
    const result = detectPrivacyConsentIssues({
      originUrl: ORIGIN,
      jurisdiction: 'UK',
      pages: [
        { url: `${ORIGIN}/`, html: HOME_WITH_GA },
        { url: `${ORIGIN}/privacy`, html: POLICY_WITHOUT_GOOGLE },
      ],
    })
    expect(
      result.findings.some((f) => f.verdict === 'human-review-consent-missing'),
    ).toBe(true)
    expect(result.inventory.consent.preConsentLoad).toBe('yes')
  })

  it('emits jurisdiction-not-set when jurisdiction is empty (no UK default)', () => {
    const result = detectPrivacyConsentIssues({
      originUrl: ORIGIN,
      jurisdiction: null,
      pages: [{ url: `${ORIGIN}/`, html: '<html><body>hi</body></html>' }],
    })
    expect(
      result.findings.some(
        (f) => f.verdict === 'human-review-jurisdiction-not-set',
      ),
    ).toBe(true)
  })

  it('emits no-privacy-page when none is discoverable', () => {
    const result = detectPrivacyConsentIssues({
      originUrl: ORIGIN,
      jurisdiction: 'UK',
      pages: [
        {
          url: `${ORIGIN}/`,
          html: `<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>`,
        },
      ],
    })
    expect(
      result.findings.some((f) => f.verdict === 'human-review-no-privacy-page'),
    ).toBe(true)
  })

  it('never emits no-privacy-page when any crawled page is the privacy page', () => {
    // Fixture-shaped: origin without trailing slash + /privacy.html in crawl.
    const result = detectPrivacyConsentIssues({
      originUrl: 'https://seoranko-fixture.vercel.app',
      jurisdiction: null,
      pages: [
        {
          url: 'https://seoranko-fixture.vercel.app',
          html: `<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>
            <footer><a href="/privacy.html">Privacy policy</a></footer>`,
        },
        {
          url: 'https://seoranko-fixture.vercel.app/privacy.html',
          html: POLICY_WITHOUT_GOOGLE,
        },
      ],
    })
    expect(result.privacyPageUrl).toContain('privacy')
    expect(
      result.findings.some((f) => f.verdict === 'human-review-no-privacy-page'),
    ).toBe(false)
    expect(
      result.findings.some((f) => f.verdict === 'human-review-vendor-unnamed'),
    ).toBe(true)
    expect(
      result.findings.some((f) => f.verdict === 'human-review-consent-missing'),
    ).toBe(true)
  })

  it('path-heuristic privacy page blocks no-privacy-page even without footer match', () => {
    const result = detectPrivacyConsentIssues({
      originUrl: 'https://example.com',
      jurisdiction: 'UK',
      pages: [
        {
          url: 'https://example.com',
          html: `<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>`,
        },
        {
          url: 'https://example.com/privacy.html',
          html: POLICY_WITHOUT_GOOGLE,
        },
      ],
    })
    expect(
      result.findings.some((f) => f.verdict === 'human-review-no-privacy-page'),
    ).toBe(false)
    expect(result.privacyPageUrl).toContain('/privacy.html')
  })
})


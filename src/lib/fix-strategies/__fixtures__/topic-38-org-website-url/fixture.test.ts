/**
 * Topic 38 D6 — entity `url` vs page URL only for page-level types.
 * Organization / WebSite / LocalBusiness / Brand / Person must never flag
 * when their url is the homepage (or any other URL).
 *
 * Autodun /privacy ships Organization{url: https://autodun.com/} — that is
 * correct schema, not a contradiction with /privacy.
 */
import { describe, expect, it } from 'vitest'
import { detectStructuredDataContradictsVisible } from '@/lib/fix-strategies/topic-38'

function page(jsonLd: unknown, body = '<p>x</p>') {
  return `<!doctype html><html><head><title>t</title>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head><body>${body}</body></html>`
}

describe('topic 38 — never flag entity-url on org/site/person types', () => {
  it('autodun /privacy Organization url=homepage is not a finding', () => {
    const result = detectStructuredDataContradictsVisible({
      html: page({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Autodun',
        url: 'https://autodun.com',
      }),
      pageUrl: 'https://autodun.com/privacy',
    })
    expect(
      result.findings.some(
        (f) => f.verdict === 'human-review-entity-url-mismatch',
      ),
    ).toBe(false)
    expect(
      result.suppressed.some(
        (s) => s.verdict === 'suppress-non-primary-entity-url',
      ),
    ).toBe(true)
  })

  it.each([
    ['Organization', 'https://example.com/'],
    ['WebSite', 'https://example.com/'],
    ['LocalBusiness', 'https://example.com/'],
    ['Brand', 'https://example.com/'],
    ['Person', 'https://example.com/'],
  ] as const)(
    'does not flag %s url pointing at homepage from /privacy',
    (type, url) => {
      const result = detectStructuredDataContradictsVisible({
        html: page({
          '@context': 'https://schema.org',
          '@type': type,
          name: 'X',
          url,
        }),
        pageUrl: 'https://example.com/privacy',
      })
      expect(
        result.findings.some(
          (f) => f.verdict === 'human-review-entity-url-mismatch',
        ),
      ).toBe(false)
    },
  )

  it('still flags Article url that disagrees with the page URL', () => {
    const result = detectStructuredDataContradictsVisible({
      html: page({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'H',
        url: 'https://example.com/other-post/',
      }),
      pageUrl: 'https://example.com/this-post/',
    })
    expect(
      result.findings.some(
        (f) => f.verdict === 'human-review-entity-url-mismatch',
      ),
    ).toBe(true)
  })
})

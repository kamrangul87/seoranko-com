import { describe, expect, it } from 'vitest'
import {
  detectStructuredDataContradictsVisible,
  normalizeDateForCompare,
} from '@/lib/fix-strategies/topic-38/detect'
import { extractStructuredData } from '@/lib/fix-strategies/shared/structured-data-extract'

const ORIGIN = 'https://shop.example'

describe('topic 38 — microdata/RDFa chrome Organization is not primary', () => {
  it('suppresses Organization url in WPHeader microdata (sitewide chrome)', () => {
    const html = `<!doctype html><html><head><title>Shop</title></head><body>
<header itemscope itemtype="https://schema.org/WPHeader">
  <div itemscope itemtype="https://schema.org/Organization">
    <a itemprop="url" href="${ORIGIN}/">Home</a>
    <span itemprop="name">Shop Co</span>
  </div>
</header>
<main>
  <h1>Shop</h1>
  <p>Products for sale on this WordPress page.</p>
</main>
<footer itemscope itemtype="https://schema.org/WPFooter"></footer>
</body></html>`

    const extraction = extractStructuredData(html, `${ORIGIN}/shop/`)
    const org = extraction.nodes.find((n) =>
      n.types.some((t) => /Organization/i.test(t)),
    )
    expect(org?.format).toBe('microdata')
    expect(org?.ancestorTypes?.some((t) => /WPHeader/i.test(t))).toBe(true)

    const result = detectStructuredDataContradictsVisible({
      html,
      pageUrl: `${ORIGIN}/shop/`,
      extraction,
    })
    expect(
      result.findings.some((f) => f.verdict === 'human-review-entity-url-mismatch'),
    ).toBe(false)
    expect(
      result.suppressed.some((s) => s.verdict === 'suppress-non-primary-entity-url'),
    ).toBe(true)
  })

  it('still raises JSON-LD Organization-only about-page mismatch', () => {
    const html = `<!doctype html><html><head><title>About</title>
<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      url: 'https://other.example/',
      name: 'Co',
    })}</script></head><body><p>About us</p></body></html>`

    const result = detectStructuredDataContradictsVisible({
      html,
      pageUrl: `${ORIGIN}/about/`,
    })
    expect(
      result.findings.some((f) => f.verdict === 'human-review-entity-url-mismatch'),
    ).toBe(true)
  })
})

describe('topic 38a — date compare as UTC calendar dates', () => {
  it('normalizes display date and timed ISO to the same UTC day', () => {
    expect(normalizeDateForCompare('April 23, 2026')).toBe('2026-04-23')
    expect(normalizeDateForCompare('2026-04-23T06:26:41+00:00')).toBe(
      '2026-04-23',
    )
  })

  it('suppresses format/time-of-day-only structured vs <time> (minso hello-world)', () => {
    const html = `<!doctype html><html><head><title>Post</title></head><body>
<div itemscope itemtype="https://schema.org/BlogPosting">
  <span itemprop="datePublished">April 23, 2026</span>
</div>
<time datetime="2026-04-23T06:26:41+00:00">April 23, 2026 at 6:26 am</time>
</body></html>`

    const result = detectStructuredDataContradictsVisible({
      html,
      pageUrl: `${ORIGIN}/hello-world/`,
    })
    expect(
      result.findings.some(
        (f) => f.verdict === 'human-review-structured-vs-structured',
      ),
    ).toBe(false)
    expect(
      result.suppressed.some((s) => s.verdict === 'suppress-format-only-date-diff'),
    ).toBe(true)
  })
})

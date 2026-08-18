import { describe, it, expect } from 'vitest'
import { extractRenderableBody } from './content-render'

describe('extractRenderableBody', () => {
  const contentFixture = [
    '<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">',
    '<h1>EV Charger Guide</h1>',
    '<p>Real body content about ev chargers.</p>',
    '<script type="application/ld+json">{"@type":"Article"}</script>',
    '<meta name="description" content="desc" />',
    '<meta property="og:title" content="EV Charger Guide" />',
    '<link rel="canonical" href="https://example.com/ev-charger" />',
    '<script type="application/ld+json">{"@type":"FAQPage"}</script>',
    '<p class="article-last-verified">Last verified: August 15, 2026</p>',
  ].join('\n')

  it('strips all ld+json script blocks, meta tags, and the canonical link', () => {
    const result = extractRenderableBody(contentFixture)
    expect(result).not.toContain('<script')
    expect(result).not.toContain('<meta')
    expect(result).not.toContain('rel="canonical"')
  })

  it('preserves real body content — headings, paragraphs, last-verified line', () => {
    const result = extractRenderableBody(contentFixture)
    expect(result).toContain('<h1>EV Charger Guide</h1>')
    expect(result).toContain('Real body content about ev chargers.')
    expect(result).toContain('Last verified: August 15, 2026')
  })

  it('returns empty/falsy input unchanged', () => {
    expect(extractRenderableBody('')).toBe('')
  })

  it('leaves figures, FAQ divs, and inline links intact', () => {
    const html = '<figure class="article-hero-image"><img src="https://x.com/a.webp" /></figure>' +
      '<div class="faq-item"><h3>Q?</h3><p>A.</p></div>' +
      '<p>See <a href="https://gov.uk/x">gov.uk</a> for details.</p>'
    const result = extractRenderableBody(html)
    expect(result).toContain('article-hero-image')
    expect(result).toContain('faq-item')
    expect(result).toContain('href="https://gov.uk/x"')
  })
})

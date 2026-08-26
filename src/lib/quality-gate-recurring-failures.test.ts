// Regression coverage for the five recurring Quality Gate failures:
// schema image, Organization logo, scannability, dated-policy, apostrophes.
// Each test asserts the MECHANICAL behaviour (detect → repair → re-verify),
// not that a prompt asked the model nicely.

import { describe, it, expect } from 'vitest'
import { buildFinalArticleArtifact } from './final-article-artifact'
import {
  articleSchemaHasUsableImage,
  assertArticleImageSynchronized,
  injectFallbackHeroFigure,
} from './article-image-guard'
import { brandLookupCandidates, selectBrandSettingsRow } from './brand-settings'
import { enforceScannability, findDenseParagraphs } from './scannability-enforcer'
import { enforceDatedPolicy } from './dated-policy-enforcer'
import { stripDateAnchors } from './date-anchor-stripper'
import { normalizeArticleTypography } from './typography-normalizer'
import { validateArticleStructure } from './structure-validator'
import { lintProse } from './prose-linter'

const SCHEMA_INPUT = {
  title: 'EV Charger Installation Costs',
  description: 'What a home EV charger costs to install.',
  keyword: 'ev charger',
  authorName: 'Test Author',
  publishDate: '2026-08-01',
  articleUrl: 'https://ev.autodun.com/ev-charger',
  organizationName: 'autodun',
  organizationUrl: 'https://autodun.com',
}

describe('issue 1 — Article.image is synchronized with the shipped image', () => {
  it('emits Article.image when a hero image ships', () => {
    const artifact = buildFinalArticleArtifact({
      proseHtml: '<h1>EV chargers</h1><p>A short body paragraph about chargers.</p>',
      imageSet: {
        hero: {
          id: 'hero-1',
          url: 'https://cdn.example.com/hero.jpg',
          alt: 'EV charger',
          width: 1200,
          height: 630,
          caption: 'A home EV charger',
          placement: 'hero',
          prompt: 'home ev charger',
        },
        content: [],
        niche: 'automotive',
        styleDescriptor: 'clean product photography',
        imageStats: { requested: 1, generated: 1, failures: [] },
      },
      schemaInput: SCHEMA_INPUT,
    })

    expect(artifact.figureCount).toBeGreaterThan(0)
    expect(artifact.primaryImageUrl).toBe('https://cdn.example.com/hero.jpg')
    expect(articleSchemaHasUsableImage(artifact.html)).toBe(true)
    expect(artifact.schemaImageError).toBeUndefined()
  })

  it('recovers the hero when normal injection finds no anchor', () => {
    const html = injectFallbackHeroFigure('<p>Body only, no heading at all.</p>', {
      url: 'https://cdn.example.com/hero.jpg',
      alt: 'EV charger',
    })
    expect(html).toContain('<figure')
    expect(html).toContain('https://cdn.example.com/hero.jpg')
  })

  it('hard-fails when the page ships an image the Article schema omits', () => {
    const html =
      '<img src="https://cdn.example.com/hero.jpg" alt="x" />' +
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"x"}</script>'
    expect(assertArticleImageSynchronized(html)).toMatch(/Article\.image post-condition failed/)
  })

  it('stays silent when no image ships at all', () => {
    expect(assertArticleImageSynchronized('<p>No images here.</p>')).toBeUndefined()
  })
})

describe('issue 2 — Organization.logo resolves across brand spellings', () => {
  it('derives lookup keys from a subdomain brand', () => {
    const candidates = brandLookupCandidates('ev.autodun.com')
    expect(candidates).toContain('ev.autodun.com')
    expect(candidates).toContain('autodun.com')
    expect(candidates).toContain('autodun')
  })

  it('strips scheme, www and path', () => {
    expect(brandLookupCandidates('https://www.autodun.com/blog')).toContain('autodun.com')
  })

  it('handles co.uk style hosts', () => {
    const candidates = brandLookupCandidates('shop.autodun.co.uk')
    expect(candidates).toContain('autodun.co.uk')
    expect(candidates).toContain('autodun')
  })

  it('finds the row stored under the bare brand when the request used a subdomain', () => {
    const candidates = brandLookupCandidates('ev.autodun.com')
    const result = selectBrandSettingsRow(candidates, [
      { brand: 'autodun', logo_url: 'https://cdn.example.com/logo.png' },
    ])
    expect(result).toMatchObject({
      configured: true,
      logoUrl: 'https://cdn.example.com/logo.png',
      matchedBrandKey: 'autodun',
    })
  })

  it('prefers a row that actually has a logo over a more specific empty one', () => {
    const candidates = brandLookupCandidates('ev.autodun.com')
    const result = selectBrandSettingsRow(candidates, [
      { brand: 'ev.autodun.com', logo_url: '' },
      { brand: 'autodun', logo_url: 'https://cdn.example.com/logo.png' },
    ])
    expect(result.logoUrl).toBe('https://cdn.example.com/logo.png')
  })

  it('reports not-configured when no row matches any spelling', () => {
    expect(selectBrandSettingsRow(brandLookupCandidates('autodun'), [])).toEqual({
      configured: false,
      logoUrl: null,
    })
  })

  it('emits Organization.logo as an ImageObject through the artifact builder', () => {
    const artifact = buildFinalArticleArtifact({
      proseHtml: '<h1>EV chargers</h1><p>Body.</p>',
      imageSet: null,
      schemaInput: { ...SCHEMA_INPUT, organizationLogoUrl: 'https://cdn.example.com/logo.png' },
    })
    expect(artifact.schemaResult.organizationLogoUrl).toBe('https://cdn.example.com/logo.png')
    expect(artifact.schemaResult.organizationSchema).toContain('"ImageObject"')
  })
})

describe('issue 3 — dense paragraphs are split and re-validated', () => {
  const sentences = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => `${prefix} sentence number ${i + 1} about home charging.`).join(' ')

  it('splits ordinary dense paragraphs until the validator agrees', () => {
    const html = Array.from({ length: 5 }, (_, i) => `<p>${sentences(7, `P${i}`)}</p>`).join('\n')
    const result = enforceScannability(html)
    expect(result.remainingDenseParagraphs).toEqual([])
    expect(result.error).toBeUndefined()
    expect(validateArticleStructure(result.html).filter(i => i.category === 'scannability')).toEqual([])
  })

  it('splits <br>-separated dense paragraphs the offset splitter cannot see', () => {
    const paragraph = `<p>${Array.from({ length: 7 }, (_, i) => `Line ${i + 1} explains installation.`).join('<br> ')}</p>`
    const html = Array.from({ length: 5 }, () => paragraph).join('\n')

    expect(findDenseParagraphs(html).length).toBe(5)
    const result = enforceScannability(html)
    expect(result.remainingDenseParagraphs).toEqual([])
    expect(result.error).toBeUndefined()
  })

  it('leaves short paragraphs and inline markup alone', () => {
    const html = '<p>One sentence with a <a href="https://example.com">link</a>. Another one.</p>'
    const result = enforceScannability(html)
    expect(result.html).toContain('<a href="https://example.com">link</a>')
    expect(result.remainingDenseParagraphs).toEqual([])
  })
})

describe('issue 4 — date anchors are stripped, then re-detected', () => {
  const now = new Date('2026-08-26T00:00:00Z')

  it('removes a leading "As of <month year>" anchor and keeps the figure', () => {
    const { html } = stripDateAnchors('<p>As of August 2026, the grant covers up to 75% of the cost.</p>')
    expect(html).toBe('<p>The grant covers up to 75% of the cost.</p>')
  })

  it('removes trailing anchors, "currently" and "the current rate is"', () => {
    expect(stripDateAnchors('<p>The grant covers 75%, as of August 2026.</p>').html).toBe(
      '<p>The grant covers 75%.</p>',
    )
    expect(stripDateAnchors('<p>The grant currently covers 75%.</p>').html).toBe(
      '<p>The grant covers 75%.</p>',
    )
    expect(stripDateAnchors('<p>The current rate is £350 per socket.</p>').html).toBe(
      '<p>The rate is £350 per socket.</p>',
    )
  })

  it('never rewrites markup, attributes or JSON-LD dates', () => {
    const html =
      '<script type="application/ld+json">{"datePublished":"2026-08-01","description":"As of August 2026, rates apply"}</script>' +
      '<p><a href="https://example.com/as-of-august-2026">Source</a> confirms it.</p>'
    expect(stripDateAnchors(html).html).toBe(html)
  })

  it('clears the time-anchored detector that drives the dated-policy category', () => {
    const article = '<p>As of August 2026, the grant covers up to 75% of installation costs.</p>'
    const result = enforceDatedPolicy(article, now)
    expect(result.strippedCount).toBeGreaterThan(0)
    expect(result.remainingTimeAnchored).toEqual([])
  })

  it('reports claims it cannot safely rewrite instead of hiding them', () => {
    const article = '<p>The scheme will rise in 2027 to £500 per socket.</p>'
    const result = enforceDatedPolicy(article, now)
    expect(result.remainingTimeAnchored.length).toBeGreaterThan(0)
  })
})

describe('issue 5 — straight apostrophes are normalized, real typos still flagged', () => {
  it('curls apostrophes and quotes in visible text', () => {
    const out = normalizeArticleTypography(`<p>It's the driver's charger and it "works".</p>`)
    expect(out).toBe('<p>It\u2019s the driver\u2019s charger and it \u201Cworks\u201D.</p>')
  })

  it('never touches attributes, JSON-LD or code', () => {
    const html =
      `<a href="https://example.com/it's-fine" title="it's">x</a>` +
      `<script type="application/ld+json">{"headline":"it's"}</script>` +
      `<code>const s = "it's"</code>`
    expect(normalizeArticleTypography(html)).toBe(html)
  })

  it('is idempotent', () => {
    const once = normalizeArticleTypography(`<p>It's here.</p>`)
    expect(normalizeArticleTypography(once)).toBe(once)
  })

  it('produces no apostrophe/quote prose findings after normalization', async () => {
    const text = normalizeArticleTypography(`<p>It's the driver's charger and it "works" well.</p>`)
      .replace(/<[^>]+>/g, '')
    const findings = await lintProse(text)
    expect(findings.filter(f => f.key === 'apostrophe-style' || f.key === 'quote-style')).toEqual([])
  })

  it('still reports a genuinely missing apostrophe as a warning', async () => {
    const findings = await lintProse('It dont matter what the installer says today.')
    const missing = findings.find(f => f.key === 'missing-apostrophe')
    expect(missing?.severity).toBe('warning')
  })
})

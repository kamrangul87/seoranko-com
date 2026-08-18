import { describe, it, expect } from 'vitest'
import { runRenderedChecks } from './publish-verification'

const validArticleSchema = {
  '@type': 'Article',
  headline: 'EV Charger Guide',
  image: 'https://x.supabase.co/hero.webp',
  datePublished: '2026-08-15T00:00:00.000Z',
  dateModified: '2026-08-15T00:00:00.000Z',
  inLanguage: 'en-GB',
}
const validOrgSchema = { '@type': 'Organization', name: 'autodun.com', logo: 'https://logo.clearbit.com/autodun.com' }

function buildHtml(opts: { canonical?: string; schemas?: object[]; withOg?: boolean; withImg?: boolean } = {}) {
  const schemas = opts.schemas ?? [validArticleSchema, validOrgSchema]
  return `
    <html><head>
      <title>EV Charger Guide</title>
      ${opts.canonical ? `<link rel="canonical" href="${opts.canonical}" />` : ''}
      ${opts.withOg !== false ? '<meta property="og:title" content="EV Charger Guide" /><meta property="og:description" content="desc" /><meta name="twitter:card" content="summary_large_image" />' : ''}
      ${schemas.map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n')}
    </head><body>
      ${opts.withImg !== false ? '<img src="https://x.supabase.co/hero.webp" />' : ''}
      <p>Body content.</p>
    </body></html>
  `
}

describe('runRenderedChecks', () => {
  const expected = { publicUrl: 'https://blog.seoranko.com/autodun/ev-charger', title: 'EV Charger Guide', description: 'desc', heroImageUrl: 'https://x.supabase.co/hero.webp' }

  it('passes every check on a well-formed rendered page', () => {
    const html = buildHtml({ canonical: expected.publicUrl })
    const checks = runRenderedChecks(html, expected)
    const failed = checks.filter(c => !c.pass)
    expect(failed).toEqual([])
  })

  it('fails M10 when the canonical is missing or points elsewhere', () => {
    const missing = runRenderedChecks(buildHtml({}), expected)
    expect(missing.find(c => c.id === 'M10-canonical')?.pass).toBe(false)

    const wrong = runRenderedChecks(buildHtml({ canonical: 'https://blog.seoranko.com/wrong/slug' }), expected)
    expect(wrong.find(c => c.id === 'M10-canonical')?.pass).toBe(false)
  })

  it('fails M02 when Article.image is missing from the rendered JSON-LD', () => {
    const brokenArticle = { ...validArticleSchema, image: undefined }
    const html = buildHtml({ canonical: expected.publicUrl, schemas: [brokenArticle, validOrgSchema] })
    const checks = runRenderedChecks(html, expected)
    expect(checks.find(c => c.id === 'M02-article-image')?.pass).toBe(false)
  })

  it('fails M07 when Organization.logo is missing from the rendered JSON-LD', () => {
    const brokenOrg = { '@type': 'Organization', name: 'autodun.com' }
    const html = buildHtml({ canonical: expected.publicUrl, schemas: [validArticleSchema, brokenOrg] })
    const checks = runRenderedChecks(html, expected)
    expect(checks.find(c => c.id === 'M07-organization-logo')?.pass).toBe(false)
  })

  it('fails M08 when dateModified is before datePublished', () => {
    const staleArticle = { ...validArticleSchema, datePublished: '2026-08-15T00:00:00.000Z', dateModified: '2026-08-01T00:00:00.000Z' }
    const html = buildHtml({ canonical: expected.publicUrl, schemas: [staleArticle, validOrgSchema] })
    const checks = runRenderedChecks(html, expected)
    expect(checks.find(c => c.id === 'M08-date-modified')?.pass).toBe(false)
  })

  it('fails jsonld-present when no script tags parse at all', () => {
    const html = buildHtml({ canonical: expected.publicUrl, schemas: [] })
    const checks = runRenderedChecks(html, expected)
    expect(checks.find(c => c.id === 'jsonld-present')?.pass).toBe(false)
  })
})

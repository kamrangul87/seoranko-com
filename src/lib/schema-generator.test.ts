import { describe, it, expect } from 'vitest'
import { generateArticleSchema, languageTagForMarket, type ArticleSchemaInput } from './schema-generator'

const baseInput: ArticleSchemaInput = {
  title: 'How much do EV chargers cost in the UK?',
  description: 'A guide to EV charger pricing.',
  keyword: 'ev charger cost uk',
  authorName: 'Jane Doe',
  publishDate: '2026-08-19T08:00:00Z',
  articleUrl: 'https://seoranko.com/blog/ev-charger-cost-uk',
  imageUrl: 'https://seoranko.com/images/hero.webp',
  wordCount: 1500,
}

describe('generateArticleSchema', () => {
  it('emits Article.image as an array, not a bare string', () => {
    const result = generateArticleSchema(baseInput)
    const parsed = JSON.parse(result.articleSchema)
    expect(Array.isArray(parsed.image)).toBe(true)
    expect(parsed.image).toEqual(['https://seoranko.com/images/hero.webp'])
  })

  it('omits Article.image entirely when no valid https imageUrl is given', () => {
    const result = generateArticleSchema({ ...baseInput, imageUrl: undefined })
    const parsed = JSON.parse(result.articleSchema)
    expect(parsed.image).toBeUndefined()
    expect(result.imageUrl).toBeUndefined()
  })

  it('emits publisher.logo as an ImageObject, not a bare string, when a logo URL is configured', () => {
    const result = generateArticleSchema({
      ...baseInput,
      organizationLogoUrl: 'https://example.com/logo.png',
    })
    const parsed = JSON.parse(result.articleSchema)
    expect(parsed.publisher.logo).toEqual({
      '@type': 'ImageObject',
      url: 'https://example.com/logo.png',
    })
  })

  it('emits organizationSchema.logo as an ImageObject too', () => {
    const result = generateArticleSchema({
      ...baseInput,
      organizationLogoUrl: 'https://example.com/logo.png',
    })
    const parsed = JSON.parse(result.organizationSchema)
    expect(parsed.logo).toEqual({
      '@type': 'ImageObject',
      url: 'https://example.com/logo.png',
    })
  })

  it('omits logo from publisher and organizationSchema when no logo URL resolves', () => {
    const result = generateArticleSchema({
      ...baseInput,
      organizationLogoUrl: undefined,
      organizationUrl: '',
    })
    const article = JSON.parse(result.articleSchema)
    const org = JSON.parse(result.organizationSchema)
    expect(article.publisher.logo).toBeUndefined()
    expect(org.logo).toBeUndefined()
    expect(result.logoOmittedReason).toBeTruthy()
  })

  it('never derives a Clearbit (or any other) fallback candidate — the API was shut down and always returned a dead URL', () => {
    const result = generateArticleSchema({
      ...baseInput,
      organizationLogoUrl: undefined,
      organizationUrl: 'https://acme.example.com',
    })
    expect(result.organizationLogoUrl).toBeUndefined()
    expect(result.logoOmittedReason).toBeTruthy()
    expect(result.logoOmittedReason).not.toContain('clearbit')
    const article = JSON.parse(result.articleSchema)
    expect(article.publisher.logo).toBeUndefined()
    const org = JSON.parse(result.organizationSchema)
    expect(org.logo).toBeUndefined()
  })

  it('uses brand_settings logoUrl as-is, never substituting a derived candidate', () => {
    const result = generateArticleSchema({
      ...baseInput,
      organizationLogoUrl: 'https://cdn.example.com/real-logo.png',
      organizationUrl: 'https://acme.example.com',
    })
    expect(result.organizationLogoUrl).toBe('https://cdn.example.com/real-logo.png')
    expect(result.logoOmittedReason).toBeUndefined()
    const article = JSON.parse(result.articleSchema)
    expect(article.publisher.logo).toEqual({
      '@type': 'ImageObject',
      url: 'https://cdn.example.com/real-logo.png',
    })
  })

  it('defaults dateModified to publishDate when not provided', () => {
    const result = generateArticleSchema(baseInput)
    const parsed = JSON.parse(result.articleSchema)
    expect(parsed.dateModified).toBe(parsed.datePublished)
  })

  it('uses the provided dateModified when given', () => {
    const result = generateArticleSchema({ ...baseInput, dateModified: '2026-08-20T09:00:00Z' })
    const parsed = JSON.parse(result.articleSchema)
    expect(parsed.dateModified).toBe('2026-08-20T09:00:00Z')
    expect(parsed.datePublished).toBe('2026-08-19T08:00:00Z')
  })

  it('sets inLanguage from the market lookup table', () => {
    const result = generateArticleSchema({ ...baseInput, market: 'United Kingdom' })
    const parsed = JSON.parse(result.articleSchema)
    expect(parsed.inLanguage).toBe('en-GB')
  })

  it('falls back to generic "en" for an unrecognised or missing market', () => {
    const result = generateArticleSchema({ ...baseInput, market: undefined })
    const parsed = JSON.parse(result.articleSchema)
    expect(parsed.inLanguage).toBe('en')
  })
})

describe('languageTagForMarket', () => {
  it('maps known markets to their BCP-47 tag', () => {
    expect(languageTagForMarket('United States')).toBe('en-US')
    expect(languageTagForMarket('germany')).toBe('de-DE')
  })

  it('defaults to "en" for unknown or missing markets', () => {
    expect(languageTagForMarket('Narnia')).toBe('en')
    expect(languageTagForMarket(undefined)).toBe('en')
  })
})

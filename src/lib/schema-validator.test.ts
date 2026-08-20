import { describe, it, expect } from 'vitest'
import { validateSchema } from './schema-validator'

function scriptTag(block: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(block)}</script>`
}

const validArticle = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'How much do EV chargers cost in the UK?',
  author: { '@type': 'Person', name: 'Jane Doe' },
  publisher: {
    '@type': 'Organization',
    name: 'SEORANKO',
    logo: { '@type': 'ImageObject', url: 'https://example.com/logo.png' },
  },
  datePublished: '2026-08-19T08:00:00Z',
  dateModified: '2026-08-19T08:00:00Z',
  inLanguage: 'en-GB',
  image: ['https://example.com/hero.webp'],
}

describe('validateSchema', () => {
  it('accepts a fully valid Article block with an ImageObject logo and array image with no errors', () => {
    const result = validateSchema(scriptTag(validArticle), { expectOrganizationLogo: true })
    const errors = result.issues.filter(i => i.severity === 'error')
    expect(errors).toHaveLength(0)
    expect(result.valid).toBe(true)
  })

  it('flags publisher.logo as an error when it is a bare URL string instead of an ImageObject', () => {
    const html = scriptTag({
      ...validArticle,
      publisher: { '@type': 'Organization', name: 'SEORANKO', logo: 'https://example.com/logo.png' },
    })
    const result = validateSchema(html, { expectOrganizationLogo: true })
    const logoIssue = result.issues.find(i => i.property === 'publisher.logo')
    expect(logoIssue?.severity).toBe('error')
    expect(logoIssue?.message).toContain('ImageObject')
  })

  it('flags dateModified earlier than datePublished as an error', () => {
    const html = scriptTag({
      ...validArticle,
      datePublished: '2026-08-19T08:00:00Z',
      dateModified: '2026-08-18T08:00:00Z',
    })
    const result = validateSchema(html)
    const dateIssue = result.issues.find(i => i.property === 'dateModified' && i.message.includes('earlier than'))
    expect(dateIssue?.severity).toBe('error')
  })

  it('does not flag dateModified when it equals or is after datePublished', () => {
    const html = scriptTag(validArticle)
    const result = validateSchema(html)
    const dateIssue = result.issues.find(i => i.property === 'dateModified' && i.message.includes('earlier than'))
    expect(dateIssue).toBeUndefined()
  })

  it('flags a headline over 110 characters as an error', () => {
    const longHeadline = 'A'.repeat(111)
    const html = scriptTag({ ...validArticle, headline: longHeadline })
    const result = validateSchema(html)
    const headlineIssue = result.issues.find(i => i.property === 'headline' && i.message.includes('characters'))
    expect(headlineIssue?.severity).toBe('error')
  })

  it('does not flag a headline at or under 110 characters', () => {
    const html = scriptTag({ ...validArticle, headline: 'A'.repeat(110) })
    const result = validateSchema(html)
    const headlineIssue = result.issues.find(i => i.property === 'headline' && i.message.includes('characters'))
    expect(headlineIssue).toBeUndefined()
  })

  it('accepts image as an array of URLs (schema-generator.ts current shape)', () => {
    const html = scriptTag({ ...validArticle, image: ['https://example.com/hero.webp'] })
    const result = validateSchema(html)
    const imageIssue = result.issues.find(i => i.property === 'image')
    expect(imageIssue).toBeUndefined()
  })

  it('accepts image as a bare string URL (legacy shape)', () => {
    const html = scriptTag({ ...validArticle, image: 'https://example.com/hero.webp' })
    const result = validateSchema(html)
    const imageIssue = result.issues.find(i => i.property === 'image')
    expect(imageIssue).toBeUndefined()
  })

  it('flags image when present but with no usable URL in any shape', () => {
    const html = scriptTag({ ...validArticle, image: [{ '@type': 'ImageObject' }] })
    const result = validateSchema(html)
    const imageIssue = result.issues.find(i => i.property === 'image')
    expect(imageIssue?.severity).toBe('error')
  })

  it('requires inLanguage on Article and flags it missing as an error', () => {
    const withoutLanguage: Record<string, unknown> = { ...validArticle }
    delete withoutLanguage.inLanguage
    const html = scriptTag(withoutLanguage)
    const result = validateSchema(html)
    const langIssue = result.issues.find(i => i.property === 'inLanguage')
    expect(langIssue?.severity).toBe('error')
  })
})

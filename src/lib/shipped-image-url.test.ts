import { describe, it, expect } from 'vitest'
import {
  isAbsoluteHttpsUrl,
  pickPrimaryShippedImageUrl,
  pickPrimaryShippedImageUrlFromHtml,
  htmlContainsShippedImageUrl,
} from './shipped-image-url'

describe('isAbsoluteHttpsUrl', () => {
  it('accepts https URLs only', () => {
    expect(isAbsoluteHttpsUrl('https://cdn.example.com/a.webp')).toBe(true)
    expect(isAbsoluteHttpsUrl('http://cdn.example.com/a.webp')).toBe(false)
    expect(isAbsoluteHttpsUrl('/relative.webp')).toBe(false)
    expect(isAbsoluteHttpsUrl('')).toBe(false)
    expect(isAbsoluteHttpsUrl(null)).toBe(false)
  })
})

describe('pickPrimaryShippedImageUrl', () => {
  it('prefers hero over content images', () => {
    expect(
      pickPrimaryShippedImageUrl({
        heroUrl: 'https://cdn.example.com/hero.webp',
        contentUrls: ['https://cdn.example.com/c1.webp'],
      }),
    ).toBe('https://cdn.example.com/hero.webp')
  })

  it('falls back to first valid content image when hero is missing', () => {
    expect(
      pickPrimaryShippedImageUrl({
        heroUrl: '',
        contentUrls: [null, 'http://insecure.example.com/x.webp', 'https://cdn.example.com/c2.webp'],
      }),
    ).toBe('https://cdn.example.com/c2.webp')
  })
})

describe('pickPrimaryShippedImageUrlFromHtml', () => {
  it('falls back to first absolute https img src in HTML', () => {
    const html = `<p>Hi</p><img src="https://cdn.example.com/from-html.webp" alt="x" />`
    expect(pickPrimaryShippedImageUrlFromHtml(html)).toBe('https://cdn.example.com/from-html.webp')
  })

  it('uses image-set hero only when that URL actually appears in the HTML', () => {
    const html = `<img src="https://cdn.example.com/hero.webp" alt="x" />`
    expect(
      pickPrimaryShippedImageUrlFromHtml(html, {
        heroUrl: 'https://cdn.example.com/hero.webp',
        contentUrls: ['https://cdn.example.com/c1.webp'],
      }),
    ).toBe('https://cdn.example.com/hero.webp')
  })

  it('does not invent Article.image from an image-set URL absent from the HTML', () => {
    const html = `<p>No figures</p>`
    expect(
      pickPrimaryShippedImageUrlFromHtml(html, {
        heroUrl: 'https://cdn.example.com/hero-not-injected.webp',
        contentUrls: ['https://cdn.example.com/c-not-injected.webp'],
      }),
    ).toBeUndefined()
  })

  it('falls back to content image in HTML when hero URL is not shipped', () => {
    const html = `<figure><img src="https://cdn.example.com/c1.webp" alt="c" /></figure>`
    expect(
      pickPrimaryShippedImageUrlFromHtml(html, {
        heroUrl: 'https://cdn.example.com/hero-missing.webp',
        contentUrls: ['https://cdn.example.com/c1.webp'],
      }),
    ).toBe('https://cdn.example.com/c1.webp')
  })

  it('htmlContainsShippedImageUrl matches exact CDN URLs', () => {
    expect(htmlContainsShippedImageUrl('<img src="https://a.com/x.webp">', 'https://a.com/x.webp')).toBe(true)
    expect(htmlContainsShippedImageUrl('<p>nope</p>', 'https://a.com/x.webp')).toBe(false)
  })
})

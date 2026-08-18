import { describe, it, expect } from 'vitest'
import {
  isAbsoluteHttpsUrl,
  pickPrimaryShippedImageUrl,
  pickPrimaryShippedImageUrlFromHtml,
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

  it('prefers image-set URLs over HTML scrape', () => {
    const html = `<img src="https://cdn.example.com/from-html.webp" alt="x" />`
    expect(
      pickPrimaryShippedImageUrlFromHtml(html, {
        heroUrl: 'https://cdn.example.com/hero.webp',
      }),
    ).toBe('https://cdn.example.com/hero.webp')
  })
})

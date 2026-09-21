import { describe, expect, it } from 'vitest'
import {
  generateVariant,
  isSiteRootUrl,
} from '@/lib/fix-strategies/shared/duplicate-url-variants'
import { proveContentSameness } from '@/lib/fix-strategies/shared/content-sameness'
import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared/url-normalize'

describe('duplicate-url variant generator (one generator, six strategies)', () => {
  it('trailing-slash flips slash and excludes site root', () => {
    expect(isSiteRootUrl('https://example.com/')).toBe(true)
    expect(isSiteRootUrl('https://example.com')).toBe(true)
    expect(generateVariant('https://example.com/', 'trailing-slash')).toBeNull()
    expect(generateVariant('https://example.com', 'trailing-slash')).toBeNull()

    const pair = generateVariant('https://example.com/page', 'trailing-slash')
    expect(pair?.b).toBe('https://example.com/page/')
    const back = generateVariant('https://example.com/page/', 'trailing-slash')
    expect(back?.b).toBe('https://example.com/page')
  })

  it('index-html covers /x vs /x/index.html (not trailing-slash)', () => {
    expect(generateVariant('https://example.com/blog', 'trailing-slash')?.b).toBe(
      'https://example.com/blog/',
    )
    expect(
      generateVariant('https://example.com/blog/index.html', 'trailing-slash'),
    ).toBeNull()
    expect(generateVariant('https://example.com/blog', 'index-html')?.b).toBe(
      'https://example.com/blog/index.html',
    )
    expect(
      generateVariant('https://example.com/blog/index.html', 'index-html')?.b,
    ).toBe('https://example.com/blog')
    expect(generateVariant('https://example.com/', 'index-html')?.b).toBe(
      'https://example.com/index.html',
    )
    expect(
      generateVariant('https://example.com/index.html', 'index-html')?.b,
    ).toBe('https://example.com/')
  })

  it('http-https flips protocol', () => {
    const pair = generateVariant('https://example.com/a', 'http-https')
    expect(pair?.b).toBe('http://example.com/a')
  })

  it('www-non-www flips host', () => {
    expect(generateVariant('https://example.com/a', 'www-non-www')?.b).toBe(
      'https://www.example.com/a',
    )
    expect(generateVariant('https://www.example.com/a', 'www-non-www')?.b).toBe(
      'https://example.com/a',
    )
  })

  it('path-case lowercases path only — never query; never host', () => {
    const pair = generateVariant(
      'https://Example.com/Apple?Token=AbC',
      'path-case',
    )
    expect(pair?.b).toBe('https://example.com/apple?Token=AbC')
    // Host lowercased by URL()/normalize; query case preserved
    expect(pair?.b).toContain('Token=AbC')
  })

  it('path-case requires uppercase hint for all-lowercase crawled URLs', () => {
    expect(generateVariant('https://example.com/apple', 'path-case')).toBeNull()
    const pair = generateVariant('https://example.com/apple', 'path-case', {
      uppercaseHint: 'https://example.com/Apple',
    })
    expect(pair?.b).toBe('https://example.com/Apple')
  })

  it('query-params yields clean path', () => {
    const pair = generateVariant(
      'https://example.com/p?utm_source=x&gclid=1',
      'query-params',
    )
    expect(pair?.b).toBe('https://example.com/p')
    expect(pair?.paramNames).toEqual(
      expect.arrayContaining(['utm_source', 'gclid']),
    )
  })

  it('url-normalize does NOT collapse slash, case, query, or port', () => {
    expect(normalizeFixStrategyUrl('https://ex.com/Page/')).toBe(
      'https://ex.com/Page/',
    )
    expect(normalizeFixStrategyUrl('https://ex.com/Page')).toBe(
      'https://ex.com/Page',
    )
    expect(normalizeFixStrategyUrl('https://ex.com/p?q=1')).toBe(
      'https://ex.com/p?q=1',
    )
    expect(normalizeFixStrategyUrl('https://ex.com:8443/p')).toBe(
      'https://ex.com:8443/p',
    )
  })

  it('content sameness must be proven', () => {
    expect(proveContentSameness('<p>same</p>', '<p>same</p>').same).toBe(true)
    expect(proveContentSameness('<p>a</p>', '<p>b</p>').same).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { normalizeCanonicalForGscMatch } from './canonical-normalize'

describe('normalizeCanonicalForGscMatch', () => {
  it('MUST NOT collapse trailing slash', () => {
    expect(normalizeCanonicalForGscMatch('https://example.com/page')).toBe(
      'https://example.com/page',
    )
    expect(normalizeCanonicalForGscMatch('https://example.com/page/')).toBe(
      'https://example.com/page/',
    )
    expect(normalizeCanonicalForGscMatch('https://example.com/page')).not.toBe(
      normalizeCanonicalForGscMatch('https://example.com/page/'),
    )
  })

  it('MUST NOT change path case', () => {
    expect(normalizeCanonicalForGscMatch('https://example.com/Page')).toBe(
      'https://example.com/Page',
    )
    expect(normalizeCanonicalForGscMatch('https://example.com/Page')).not.toBe(
      normalizeCanonicalForGscMatch('https://example.com/page'),
    )
  })

  it('strips the fragment', () => {
    expect(
      normalizeCanonicalForGscMatch('https://example.com/page#section'),
    ).toBe('https://example.com/page')
  })

  it('lowercases scheme and host and resolves dots', () => {
    expect(
      normalizeCanonicalForGscMatch('HTTPS://Ex.COM/a/./b/../c'),
    ).toBe('https://ex.com/a/c')
  })
})

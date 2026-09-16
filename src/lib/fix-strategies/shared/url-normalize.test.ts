import { describe, expect, it } from 'vitest'
import {
  normalizeFixStrategyUrl,
  preserveQueryAndFragment,
  wouldDropQueryOrFragment,
} from './url-normalize'

describe('normalizeFixStrategyUrl', () => {
  it('MUST NOT collapse trailing slash — /page !== /page/', () => {
    const a = normalizeFixStrategyUrl('https://example.com/page')
    const b = normalizeFixStrategyUrl('https://example.com/page/')
    expect(a).toBe('https://example.com/page')
    expect(b).toBe('https://example.com/page/')
    expect(a).not.toBe(b)
  })

  it('MUST NOT change path case — /Page !== /page', () => {
    const a = normalizeFixStrategyUrl('https://example.com/Page')
    const b = normalizeFixStrategyUrl('https://example.com/page')
    expect(a).toBe('https://example.com/Page')
    expect(b).toBe('https://example.com/page')
    expect(a).not.toBe(b)
  })

  it('MUST preserve the query string', () => {
    expect(normalizeFixStrategyUrl('https://example.com/x?a=1&b=2')).toBe(
      'https://example.com/x?a=1&b=2',
    )
  })

  it('MUST preserve non-default port :8080', () => {
    expect(normalizeFixStrategyUrl('https://example.com:8080/path')).toBe(
      'https://example.com:8080/path',
    )
  })

  it('lowercases host and resolves dot segments', () => {
    expect(normalizeFixStrategyUrl('https://Ex.com/a/./b/../c')).toBe(
      'https://ex.com/a/c',
    )
  })

  it('resolves relative URLs against base', () => {
    expect(normalizeFixStrategyUrl('/page', 'https://Ex.com')).toBe(
      'https://ex.com/page',
    )
  })

  it('may strip the fragment', () => {
    expect(normalizeFixStrategyUrl('https://example.com/x#section')).toBe(
      'https://example.com/x',
    )
  })

  it('returns null for unparseable input', () => {
    expect(normalizeFixStrategyUrl('not a url')).toBeNull()
    expect(normalizeFixStrategyUrl('')).toBeNull()
  })
})

describe('preserveQueryAndFragment (topic 42 condition 5)', () => {
  it('preserves utm query and fragment onto the final path', () => {
    expect(
      preserveQueryAndFragment(
        '/old?utm_source=x#section',
        'https://example.com/new',
        'https://example.com/page',
      ),
    ).toBe('/new?utm_source=x#section')
  })

  it('does not drop query when destination already has other params', () => {
    expect(
      preserveQueryAndFragment(
        '/old?utm_source=x#section',
        'https://example.com/new?id=1',
        'https://example.com/page',
      ),
    ).toBe('/new?id=1&utm_source=x#section')
  })

  it('wouldDropQueryOrFragment detects a bare /new rewrite', () => {
    expect(
      wouldDropQueryOrFragment(
        '/old?utm_source=x#section',
        '/new',
        'https://example.com/',
      ),
    ).toBe(true)
    expect(
      wouldDropQueryOrFragment(
        '/old?utm_source=x#section',
        '/new?utm_source=x#section',
        'https://example.com/',
      ),
    ).toBe(false)
  })
})

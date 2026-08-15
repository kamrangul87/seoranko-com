import { describe, it, expect } from 'vitest'
import { normalizeBrandKey } from './internal-link-engine'

describe('normalizeBrandKey', () => {
  it('treats a bare brand name and its .com domain as the same key', () => {
    // Confirmed in production: internal_link_registry rows for this
    // account are keyed brand="autodun" while the newest generated
    // article carries brand="autodun.com" — an exact match returned zero
    // rows despite 4 active links genuinely existing for this brand.
    expect(normalizeBrandKey('autodun.com')).toBe(normalizeBrandKey('autodun'))
  })

  it('strips protocol, www, and path like citationDomain normalization elsewhere', () => {
    expect(normalizeBrandKey('https://www.autodun.com/some/path')).toBe('autodun')
  })

  it('strips a compound co.uk suffix', () => {
    expect(normalizeBrandKey('fitford.co.uk')).toBe('fitford')
  })

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeBrandKey('  Autodun.COM  ')).toBe('autodun')
  })

  it('does not conflate two genuinely different brands', () => {
    expect(normalizeBrandKey('autodun.com')).not.toBe(normalizeBrandKey('fitford.com'))
  })
})

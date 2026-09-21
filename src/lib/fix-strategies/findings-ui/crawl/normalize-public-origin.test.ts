import { describe, expect, it } from 'vitest'
import { normalizePublicOrigin } from './normalize-public-origin'

describe('normalizePublicOrigin', () => {
  it('accepts bare host and https URL', () => {
    expect(normalizePublicOrigin('example.com')).toBe('https://example.com')
    expect(normalizePublicOrigin('https://example.com/path?q=1')).toBe(
      'https://example.com',
    )
  })

  it('strips www and upgrades http', () => {
    expect(normalizePublicOrigin('http://www.example.com/')).toBe(
      'https://example.com',
    )
  })

  it('rejects empty, localhost, and private hosts', () => {
    expect(normalizePublicOrigin('')).toBeNull()
    expect(normalizePublicOrigin('localhost')).toBeNull()
    expect(normalizePublicOrigin('http://127.0.0.1')).toBeNull()
    expect(normalizePublicOrigin('https://192.168.1.1')).toBeNull()
    expect(normalizePublicOrigin('https://10.0.0.5')).toBeNull()
    expect(normalizePublicOrigin('https://172.16.0.1')).toBeNull()
    expect(normalizePublicOrigin('https://app.local')).toBeNull()
  })

  it('rejects non-http(s) schemes', () => {
    expect(normalizePublicOrigin('ftp://example.com')).toBeNull()
    expect(normalizePublicOrigin('javascript:alert(1)')).toBeNull()
  })
})

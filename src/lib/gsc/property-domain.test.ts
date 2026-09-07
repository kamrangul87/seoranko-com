import { describe, expect, it } from 'vitest'
import { brandHintFromDomain, domainFromGscPropertyUrl } from './property-domain'

describe('domainFromGscPropertyUrl', () => {
  it('parses sc-domain properties', () => {
    expect(domainFromGscPropertyUrl('sc-domain:ev.example.com')).toBe('ev.example.com')
    expect(domainFromGscPropertyUrl('sc-domain:example.com')).toBe('example.com')
  })

  it('parses URL-prefix properties and strips www', () => {
    expect(domainFromGscPropertyUrl('https://www.example.com/')).toBe('example.com')
    expect(domainFromGscPropertyUrl('https://ai.example.com/blog')).toBe('ai.example.com')
  })

  it('returns null for empty input', () => {
    expect(domainFromGscPropertyUrl('')).toBeNull()
  })
})

describe('brandHintFromDomain', () => {
  it('uses the registrable label', () => {
    expect(brandHintFromDomain('example.com')).toBe('example')
    expect(brandHintFromDomain('ev.example.com')).toBe('example')
  })
})

import { describe, expect, it } from 'vitest'
import {
  jurisdictionSettingsHref,
  normalizeSiteJurisdiction,
} from './jurisdiction'

describe('normalizeSiteJurisdiction', () => {
  it('accepts UK / EU / US and refuses a silent default', () => {
    expect(normalizeSiteJurisdiction('UK')).toBe('UK')
    expect(normalizeSiteJurisdiction('EU')).toBe('EU')
    expect(normalizeSiteJurisdiction('US')).toBe('US')
    expect(normalizeSiteJurisdiction('')).toBeNull()
    expect(normalizeSiteJurisdiction('Atlantis')).toBeNull()
  })
})

describe('jurisdictionSettingsHref', () => {
  it('links the Topic 72 finding to Sites settings', () => {
    expect(jurisdictionSettingsHref('site-1')).toBe(
      '/dashboard/settings#site-jurisdiction-site-1',
    )
  })
})
